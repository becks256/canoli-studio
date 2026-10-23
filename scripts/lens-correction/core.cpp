#include "lensfun.h"
#include <algorithm>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <memory>
#include <set>
#include <stdexcept>
#include <tuple>
#include <vector>
#ifdef __EMSCRIPTEN__
#include <emscripten/heap.h>
#endif

static std::unique_ptr<lfLens> lens;
static std::unique_ptr<lfLens> range_lens;
struct Cohort {float crop,aspect;uint32_t families=0;int models[3]={};std::unique_ptr<lfLens> value;};
static std::vector<Cohort> cohorts;
static std::unique_ptr<lfModifier> modifier;
static std::vector<float> buffer;
static uint32_t info[8] = {};
static float coefficients[32] = {};
static char error_message[1024] = {};
using PointKey=std::tuple<int,float,float,float,float,float>;
static std::set<PointKey> points;

static void require(bool condition,const char*message){if(!condition)throw std::runtime_error(message);}
static bool positive(double x){return std::isfinite(x)&&x>0&&float(x)>0&&std::isfinite(float(x));}
static bool region(int x,int y,int w,int h){return x>=0&&y>=0&&w>0&&h>0&&int64_t(x)+w<=info[1]&&int64_t(y)+h<=info[2];}
static bool readable(const void*pointer,size_t length){
    if(!pointer)return false;
#ifdef __EMSCRIPTEN__
    const auto start=reinterpret_cast<uintptr_t>(pointer),size=emscripten_get_heap_size();
    return start<=size&&length<=size-start;
#else
    return true;
#endif
}
static char* label(const char*text,uint32_t length){
    require(length<=4096&&readable(text,length),"Invalid lens label extent.");
    require(!std::memchr(text,0,length),"Lens labels cannot contain a null byte.");
    auto result=static_cast<char*>(std::calloc(size_t(length)+2,1));
    if(!result)throw std::bad_alloc();
    std::memcpy(result,text,length);return result;
}
static std::unique_ptr<lfLens> fresh_lens(const lfLens&source,float crop,float aspect){
    auto result=std::make_unique<lfLens>();result->Maker=label(source.Maker,uint32_t(std::strlen(source.Maker)));result->Model=label(source.Model,uint32_t(std::strlen(source.Model)));
    result->Type=LF_RECTILINEAR;result->CropFactor=crop;result->AspectRatio=aspect;result->CenterX=source.CenterX;result->CenterY=source.CenterY;result->MinFocal=source.MinFocal;result->MaxFocal=source.MaxFocal;return result;
}
static Cohort& cohort(float crop,float aspect){
    for(auto&entry:cohorts)if(entry.crop==crop&&entry.aspect==aspect)return entry;
    require(cohorts.size()<128,"Lens calibration frames exceed the private metadata budget.");
    Cohort entry;entry.crop=crop;entry.aspect=aspect;entry.value=fresh_lens(*lens,crop,aspect);cohorts.push_back(std::move(entry));return cohorts.back();
}
static lfLens* closest(uint32_t family,float crop){
    lfLens*result=nullptr;float ratio=1e6f;
    // Match the pinned upstream family/cohort routing rule. Its AddCalib path
    // currently collapses every group into Calibrations[0], so each declared
    // frame must own a separate actual lfLens before interpolation.
    for(auto&entry:cohorts){const float candidate=crop/entry.crop;if((entry.families&family)&&candidate>=.96f&&candidate<ratio){result=entry.value.get();ratio=candidate;}}
    return result;
}
template<typename Work>static int checked(Work work){
    error_message[0]=0;
    try{work();if(error_message[0])throw std::runtime_error(error_message);return 0;}
    catch(const std::exception&error){char message[1024]={};std::snprintf(message,sizeof(message),"%s",error.what());std::memcpy(error_message,message,sizeof(message));return -1;}
    catch(...){std::snprintf(error_message,sizeof(error_message),"Native lens correction failed.");return -1;}
}
// Positive polynomial on [0,max], including stable roots of its derivative.
static bool positive_cubic(double a,double b,double c,double max){
    std::vector<double> positions={0,max};const double A=3*c,B=2*b,C=a;
    if(A==0){if(B!=0)positions.push_back(-C/B);}
    else{const double d=B*B-4*A*C;if(d>=0){const double s=std::sqrt(d),q=-.5*(B+(B<0?-s:s));if(q==0)positions.push_back(-B/(2*A));else{positions.push_back(q/A);positions.push_back(C/q);}}}
    for(double t:positions)if(t>=0&&t<=max){const double value=1+t*(a+t*(b+t*c));if(!std::isfinite(value)||value<=0)return false;}
    return true;
}
// These overloads are defined by the pinned upstream correction units.
lfLensCalibDistortion rescale_polynomial_coefficients(const lfLensCalibDistortion&,double);
lfLensCalibTCA rescale_polynomial_coefficients(const lfLensCalibTCA&,double,int);
lfLensCalibVignetting rescale_polynomial_coefficients(const lfLensCalibVignetting&,double);
static void check_geometry(const lfLensCalibDistortion*d,const lfLensCalibTCA*tca,const lfLensCalibVignetting*v,double crop,double width,double height,double scale,double real_focal){
    const double span_x=std::max(width-1,1.0),span_y=std::max(height-1,1.0),size=std::min(span_x,span_y);
    const double cx=span_x/2+size/2*lens->CenterX,cy=span_y/2+size/2*lens->CenterY;
    double maximum=0;for(double x:{-.5,width-.5})for(double y:{-.5,height-.5})maximum=std::max(maximum,std::hypot(x-cx,y-cy));
    const double norm=std::hypot(36.,24.)/crop/std::hypot(span_x+1,span_y+1)/real_focal,r=maximum*norm/scale;
    require(positive(real_focal)&&std::isfinite(norm)&&std::isfinite(r),"Lens normalization exceeds native precision.");
    double distorted=r;
    if(d){
        require(d->Model!=LF_DIST_MODEL_POLY3||1-d->Terms[0]>0,"Invalid distortion central scale.");
        require(d->Model!=LF_DIST_MODEL_PTLENS||1-d->Terms[0]-d->Terms[1]-d->Terms[2]>0,"Invalid distortion central scale.");
        const auto value=rescale_polynomial_coefficients(*d,real_focal);for(float n:value.Terms)require(std::isfinite(n),"Lens distortion coefficients exceed native precision.");
        const double a=value.Terms[0],b=value.Terms[1],c=value.Terms[2];double factor=1;
        if(d->Model==LF_DIST_MODEL_POLY3){require(positive_cubic(3*a,0,0,r*r),"Lens distortion folds within this image.");factor+=a*r*r;}
        else if(d->Model==LF_DIST_MODEL_POLY5){require(positive_cubic(3*a,5*b,0,r*r),"Lens distortion folds within this image.");factor+=a*r*r+b*r*r*r*r;}
        else{require(positive_cubic(2*c,3*b,4*a,r),"Lens distortion folds within this image.");factor+=c*r+b*r*r+a*r*r*r;}
        distorted*=factor;require(std::isfinite(distorted),"Lens distorted radius exceeds native precision.");
    }
    if(tca){
        const auto value=rescale_polynomial_coefficients(*tca,real_focal,0);for(float n:value.Terms)require(std::isfinite(n),"Lens chromatic coefficients exceed native precision.");
        for(int channel=0;channel<2;channel++){
            const double a=value.Terms[channel],b=tca->Model==LF_TCA_MODEL_POLY3?value.Terms[channel+2]:0,c=tca->Model==LF_TCA_MODEL_POLY3?value.Terms[channel+4]:0;
            require(a>0&&positive_cubic(2*b/a,3*c/a,0,distorted),"Lens chromatic correction folds within this image.");
        }
    }
    if(v){const auto value=rescale_polynomial_coefficients(*v,real_focal);for(float n:value.Terms)require(std::isfinite(n),"Lens vignette coefficients exceed native precision.");const double radius=maximum*norm;require(positive_cubic(value.Terms[0],value.Terms[1],value.Terms[2],radius*radius),"Lens vignette attenuation must remain positive throughout this image.");}
}

extern "C" {
void g_warning(const char*format,...){va_list args;va_start(args,format);std::vsnprintf(error_message,sizeof(error_message),format,args);va_end(args);}
#ifdef CANOLI_LENS_CORE_WASM
void lf_free(void*data){std::free(data);}
#endif
const char*canoli_lens_error(){return error_message;}
const uint32_t*canoli_lens_info(){return info;}
const float*canoli_lens_coefficients(){return coefficients;}
const float*canoli_lens_data(){return buffer.data();}
void canoli_lens_release(){modifier.reset();cohorts.clear();range_lens.reset();lens.reset();points.clear();std::vector<float>().swap(buffer);std::memset(info,0,sizeof(info));std::memset(coefficients,0,sizeof(coefficients));}
int canoli_lens_create(const char*maker,uint32_t maker_length,const char*model,uint32_t model_length,double crop,double aspect,double center_x,double center_y,double min_focal,double max_focal){
    canoli_lens_release();return checked([&]{
        require(positive(crop)&&positive(aspect)&&aspect>=1&&std::isfinite(center_x)&&std::isfinite(center_y)&&std::abs(center_x)<=1&&std::abs(center_y)<=1,"Invalid lens calibration geometry.");
        require((min_focal==0||positive(min_focal))&&(max_focal==0||positive(max_focal))&&(max_focal==0||min_focal==0||max_focal>=min_focal),"Invalid lens focal range.");
        auto next=std::make_unique<lfLens>();next->Maker=label(maker,maker_length);next->Model=label(model,model_length);
        next->Type=LF_RECTILINEAR;next->CropFactor=float(crop);next->AspectRatio=float(aspect);next->CenterX=float(center_x);next->CenterY=float(center_y);next->MinFocal=float(min_focal);next->MaxFocal=float(max_focal);auto ranges=fresh_lens(*next,float(crop),float(aspect));lens=std::move(next);range_lens=std::move(ranges);
    });
}
int canoli_lens_add(int kind,int model,double focal,double aperture,double distance,double real_focal,double crop,double aspect,const float*terms,uint32_t count){
    const int status=checked([&]{
        require(lens&&range_lens&&!modifier,"Create a lens before adding calibration points.");
        require(positive(focal)&&positive(crop)&&positive(aspect)&&aspect>=1,"Invalid lens calibration coordinates.");
        const bool none=(kind==1||kind==2)&&model==0;
        const uint32_t expected=kind==1?(model==1?1:model==2?2:model==3?3:0):kind==2?(model==1?2:model==2?6:0):kind==3&&model==1?3:0;
        require((expected||none)&&count==expected&&readable(terms,count*sizeof(float)),"Unsupported lens calibration model or coefficient extent.");
        for(uint32_t i=0;i<count;i++)require(std::isfinite(terms[i]),"Lens calibration coefficients must be finite float32 values.");
        require(points.size()<50000,"Lens calibration metadata exceeds the private point budget.");
        require(std::isfinite(aperture)&&aperture>=0&&std::isfinite(distance)&&distance>=0&&(real_focal==0||positive(real_focal)),"Invalid lens calibration metadata.");
        const PointKey key={kind,float(crop),float(aspect),float(focal),kind==3?float(aperture):0,kind==3?float(distance):0};require(!points.count(key),"Duplicate lens calibration point.");
        const lfLensCalibAttributes attributes={float(crop),float(aspect)};
        auto&frame=cohort(float(crop),float(aspect));require(none||frame.models[kind-1]==0||frame.models[kind-1]==model,"Mixed calibration models within a frame/family are unsupported.");
        if(kind==1){lfLensCalibDistortion value={};value.Model=lfDistortionModel(model);value.Focal=float(focal);value.RealFocalMeasured=real_focal>0;value.RealFocal=real_focal>0?float(real_focal):float(focal)*(model==1?1-terms[0]:model==3?1-terms[0]-terms[1]-terms[2]:1);require(positive(value.RealFocal),"Invalid real focal length.");std::copy(terms,terms+count,value.Terms);value.CalibAttr=attributes;frame.value->AddCalibDistortion(&value);range_lens->AddCalibDistortion(&value);}
        else if(kind==2){lfLensCalibTCA value={};value.Model=lfTCAModel(model);value.Focal=float(focal);std::copy(terms,terms+count,value.Terms);value.CalibAttr=attributes;frame.value->AddCalibTCA(&value);range_lens->AddCalibTCA(&value);}
        else{require(positive(aperture)&&positive(distance),"Vignette calibration needs aperture and focus distance.");lfLensCalibVignetting value={};value.Model=LF_VIGNETTING_MODEL_PA;value.Focal=float(focal);value.Aperture=float(aperture);value.Distance=float(distance);std::copy(terms,terms+count,value.Terms);value.CalibAttr=attributes;frame.value->AddCalibVignetting(&value);range_lens->AddCalibVignetting(&value);}
        if(!none)frame.models[kind-1]=model;frame.families|=kind==1?8:kind==2?1:2;
        points.insert(key);
    });
    if(status)canoli_lens_release();
    return status;
}
int canoli_lens_initialize(double focal,double crop,int width,int height,double aperture,double distance,double scale,uint32_t flags){
    modifier.reset();std::memset(info,0,sizeof(info));std::memset(coefficients,0,sizeof(coefficients));
    const int status=checked([&]{
        require(lens&&range_lens&&positive(focal)&&positive(crop)&&width>0&&height>0&&std::isfinite(scale)&&scale>=.1&&scale<=10&&!(flags&~uint32_t(11)),"Invalid lens correction request.");
        require((aperture==0||positive(aperture))&&(distance==0||positive(distance)),"Invalid lens exposure coordinates.");
        range_lens->GuessParameters();
        for(auto&entry:cohorts){entry.value->MinFocal=range_lens->MinFocal;entry.value->MaxFocal=range_lens->MaxFocal;entry.value->MinAperture=range_lens->MinAperture;entry.value->MaxAperture=range_lens->MaxAperture;}
        lfLensCalibDistortion d={},optics={};lfLensCalibTCA tca={};lfLensCalibVignetting v={};
        auto*distortion_lens=closest(8,float(crop));auto*tca_lens=closest(1,float(crop));auto*vignette_lens=closest(2,float(crop));
        const bool has_distortion=distortion_lens&&distortion_lens->InterpolateDistortion(float(crop),float(focal),optics);const double real_focal=has_distortion?optics.RealFocal:float(focal);
        const float focus=distance==0?std::numeric_limits<float>::max():float(distance);
        if(flags&8){require(has_distortion,"No distortion calibration covers this crop factor.");d=optics;}
        if(flags&1)require(tca_lens&&tca_lens->InterpolateTCA(float(crop),float(focal),tca),"No chromatic calibration covers this crop factor.");
        if(flags&2)require(aperture>0&&vignette_lens&&vignette_lens->InterpolateVignetting(float(crop),float(focal),float(aperture),focus,v),"No vignette calibration covers these exposure coordinates.");
        check_geometry(flags&8?&d:nullptr,flags&1?&tca:nullptr,flags&2?&v:nullptr,crop,width,height,scale,real_focal);
        auto next=std::make_unique<lfModifier>(has_distortion?distortion_lens:lens.get(),float(focal),float(crop),width,height,LF_PF_F32);
        if((flags&8)&&std::any_of(d.Terms,d.Terms+5,[](float x){return x!=0;}))next->EnableDistortionCorrection(d);
        if((flags&1)&&(tca.Terms[0]!=1||tca.Terms[1]!=1||std::any_of(tca.Terms+2,tca.Terms+12,[](float x){return x!=0;})))next->EnableTCACorrection(tca);
        if((flags&2)&&std::any_of(v.Terms,v.Terms+3,[](float x){return x!=0;}))next->EnableVignettingCorrection(v);
        next->EnableScaling(float(scale));
        info[0]=1;info[1]=uint32_t(width);info[2]=uint32_t(height);info[3]=flags;info[4]=uint32_t(next->GetModFlags());info[5]=uint32_t(d.Model);info[6]=uint32_t(tca.Model);info[7]=uint32_t(v.Model);
        std::copy(d.Terms,d.Terms+5,coefficients);coefficients[5]=d.RealFocal;coefficients[6]=d.CalibAttr.CropFactor;coefficients[7]=d.CalibAttr.AspectRatio;coefficients[8]=d.Focal;
        std::copy(tca.Terms,tca.Terms+12,coefficients+9);coefficients[21]=tca.CalibAttr.CropFactor;coefficients[22]=tca.CalibAttr.AspectRatio;
        std::copy(v.Terms,v.Terms+3,coefficients+23);coefficients[26]=v.CalibAttr.CropFactor;coefficients[27]=v.CalibAttr.AspectRatio;coefficients[28]=v.Focal;coefficients[29]=v.Aperture;coefficients[30]=v.Distance;coefficients[31]=float(real_focal);
        modifier=std::move(next);
    });
    if(status){modifier.reset();std::memset(info,0,sizeof(info));std::memset(coefficients,0,sizeof(coefficients));buffer.clear();}
    return status;
}
int canoli_lens_coordinates(int x,int y,int width,int height){
    return checked([&]{require(modifier&&region(x,y,width,height),"Invalid lens coordinate region or lifetime.");require(uint64_t(width)*height*6<=1000000,"Lens coordinate region exceeds the private scratch budget.");buffer.resize(size_t(width)*height*6);
        // Absolute-point calls avoid upstream float32 scanline accumulation and
        // make results independent of worker strip/region partitioning.
        for(int j=0;j<height;j++)for(int i=0;i<width;i++){
            float*out=buffer.data()+(size_t(j)*width+i)*6;
            if(!modifier->ApplySubpixelGeometryDistortion(float(x+i),float(y+j),1,1,out))for(int c=0;c<3;c++){out[c*2]=float(x+i);out[c*2+1]=float(y+j);}
        }
        for(float value:buffer)require(std::isfinite(value),"Lens correction produced a non-finite coordinate.");
    });
}
int canoli_lens_gains(int x,int y,int width,int height){
    return checked([&]{require(modifier&&region(x,y,width,height),"Invalid lens gain region or lifetime.");require(uint64_t(width)*height<=1000000,"Lens gain region exceeds the private scratch budget.");buffer.assign(size_t(width)*height,1.f);
        for(int j=0;j<height;j++)for(int i=0;i<width;i++)modifier->ApplyColorModification(buffer.data()+size_t(j)*width+i,float(x+i),float(y+j),1,1,LF_CR_1(GREEN),sizeof(float));
        for(float value:buffer)require(positive(value),"Lens correction produced a nonpositive or non-finite gain.");
    });
}
}

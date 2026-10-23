// Independent reference driver: link the complete, unmodified upstream Lensfun
// library and real GLib. Do not link core.cpp or the WASM compatibility slice.
#include <lensfun.h>
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <vector>

int main(int argc,char**argv){
    if(argc!=14&&argc!=16){std::fprintf(stderr,"xml output width height focal crop aperture distance scale flags flip left top [roiWidth roiHeight]\n");return 2;}
    lfDatabase database;
    if(database.Load(argv[1])!=LF_NO_ERROR||!database.GetLenses()||!database.GetLenses()[0])return 3;
    const int width=std::atoi(argv[3]),height=std::atoi(argv[4]),flags=std::atoi(argv[10]),flip=std::atoi(argv[11]),left=std::atoi(argv[12]),top=std::atoi(argv[13]);
    const float focal=std::atof(argv[5]),crop=std::atof(argv[6]),aperture=std::atof(argv[7]),distance=std::atof(argv[8]),scale=std::atof(argv[9]);
    auto*lens=const_cast<lfLens*>(database.GetLenses()[0]);float x=lens->CenterX*(flip&1?-1:1),y=lens->CenterY*(flip&2?-1:1);if(flip&4)std::swap(x,y);lens->CenterX=x;lens->CenterY=y;
    lfModifier modifier(lens,focal,crop,width,height,LF_PF_F32);
    if(flags&8)modifier.EnableDistortionCorrection();if(flags&1)modifier.EnableTCACorrection();if(flags&2)modifier.EnableVignettingCorrection(aperture,distance==0?std::numeric_limits<float>::max():distance);modifier.EnableScaling(scale);
    // Defaults to a 64x48 ROI, including an offset ROI in a genuine 50 MP frame.
    // Optional bounded strips support full-image independent reference sampling.
    const int w=argc==16?std::atoi(argv[14]):64,h=argc==16?std::atoi(argv[15]):48;
    if(w<1||h<1||w>width||h>height||left<0||top<0||left>width-w||top>height-h||uint64_t(w)*h>1000000)return 6;
    std::vector<float> coordinates(size_t(w)*h*6),gains(size_t(w)*h,1);
    for(int j=0;j<h;j++)for(int i=0;i<w;i++){
        float*out=coordinates.data()+(j*w+i)*6;
        if(!modifier.ApplySubpixelGeometryDistortion(float(left+i),float(top+j),1,1,out))for(int c=0;c<3;c++){out[c*2]=float(left+i);out[c*2+1]=float(top+j);}
        modifier.ApplyColorModification(gains.data()+j*w+i,float(left+i),float(top+j),1,1,LF_CR_1(GREEN),sizeof(float));
    }
    FILE*output=std::fopen(argv[2],"wb");if(!output)return 4;
    const auto a=std::fwrite(coordinates.data(),sizeof(float),coordinates.size(),output),b=std::fwrite(gains.data(),sizeof(float),gains.size(),output);const auto result=std::fclose(output);
    return a==coordinates.size()&&b==gains.size()&&!result?0:5;
}

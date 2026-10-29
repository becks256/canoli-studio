#include <lcms2.h>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <cmath>

// One private module per host operation. No file, device, network, or plugin API.
static cmsContext context = nullptr;
static cmsHTRANSFORM transform = nullptr;
static uint32_t fields[8] = {};
static char text[4][2048] = {};
static char message[1024] = {};
static bool failed = false;
static uint32_t input_format = 0, output_format = 0;
static void log_error(cmsContext, cmsUInt32Number code, const char* detail) {
    failed = true;
    std::snprintf(message, sizeof(message), "Little CMS %u: %s", code, detail ? detail : "ICC operation failed");
}
static int fail(const char* detail) {
    std::snprintf(message, sizeof(message), "%s", detail);
    return 0;
}
extern "C" {
void canoli_icc_close() {
    if (transform) cmsDeleteTransform(transform);
    transform = nullptr;
    input_format = output_format = 0;
    if (context) cmsDeleteContext(context);
    context = nullptr;
}
const char* canoli_icc_error() { return message; }
const uint32_t* canoli_icc_info() { return fields; }
const char* canoli_icc_text(uint32_t index) { return index < 4 ? text[index] : nullptr; }
uint32_t canoli_icc_version() { return LCMS_VERSION; }
}
static bool begin() {
    canoli_icc_close();
    std::memset(fields, 0, sizeof(fields));
    std::memset(text, 0, sizeof(text));
    message[0] = 0;
    failed = false;
    context = cmsCreateContext(nullptr, nullptr);
    if (!context) { fail("ICC context allocation failed."); return false; }
    cmsSetLogErrorHandlerTHR(context, log_error);
    return true;
}
static cmsHPROFILE open_profile(const uint8_t* bytes, uint32_t length) {
    if (!bytes || length < 132) { fail("ICC profile requires a complete header and tag table."); return nullptr; }
    uint32_t declared = (uint32_t(bytes[0]) << 24) | (uint32_t(bytes[1]) << 16) | (uint32_t(bytes[2]) << 8) | bytes[3];
    if (declared != length) { fail("ICC declared profile size does not match its complete source bytes."); return nullptr; }
    return cmsOpenProfileFromMemTHR(context, bytes, length);
}
static void describe(cmsHPROFILE profile) {
    fields[0] = cmsGetEncodedICCversion(profile);
    fields[1] = cmsGetDeviceClass(profile);
    fields[2] = cmsGetColorSpace(profile);
    fields[3] = cmsGetPCS(profile);
    fields[4] = cmsChannelsOfColorSpace(cmsGetColorSpace(profile));
    for (uint32_t intent = 0; intent < 4; ++intent) {
        if (cmsIsIntentSupported(profile, intent, LCMS_USED_AS_INPUT)) fields[5] |= 1u << intent;
        if (cmsIsIntentSupported(profile, intent, LCMS_USED_AS_OUTPUT)) fields[6] |= 1u << intent;
        if (cmsIsIntentSupported(profile, intent, LCMS_USED_AS_PROOF)) fields[7] |= 1u << intent;
    }
    const cmsInfoType types[4] = {cmsInfoDescription, cmsInfoCopyright, cmsInfoManufacturer, cmsInfoModel};
    for (uint32_t i = 0; i < 4; ++i) {
        cmsGetProfileInfoUTF8(profile, types[i], "en", "US", text[i], sizeof(text[i]));
        text[i][sizeof(text[i]) - 1] = 0;
    }
}
static bool rgb_profile(cmsHPROFILE profile) {
    const auto kind = cmsGetDeviceClass(profile);
    return cmsGetColorSpace(profile) == cmsSigRgbData &&
        (kind == cmsSigInputClass || kind == cmsSigDisplayClass ||
         kind == cmsSigOutputClass || kind == cmsSigColorSpaceClass);
}
static cmsUInt32Number pixel_type(uint32_t format) {
    return format == 0 ? TYPE_RGBA_8 : format == 1 ? TYPE_RGBA_16 : TYPE_RGBA_FLT;
}
static bool finite_window(const void* window, uint32_t pixels) {
    const float* values = static_cast<const float*>(window);
    for (uint64_t i = 0; i < uint64_t(pixels) * 4; ++i) {
        if (!std::isfinite(values[i]) || (i % 4 == 3 && (values[i] < 0 || values[i] > 1))) return false;
    }
    return true;
}
extern "C" {
int canoli_icc_inspect(const uint8_t* bytes, uint32_t length) {
    if (!begin()) return 0;
    cmsHPROFILE profile = open_profile(bytes, length);
    if (!profile) return 0;
    describe(profile);
    cmsCloseProfile(profile);
    return 1;
}
// mode 0: sRGB -> output RGB; mode 1: output-device proof -> display sRGB.
int canoli_icc_begin(const uint8_t* bytes, uint32_t length, uint32_t mode,
                     uint32_t intent, uint32_t proof_intent, uint32_t bpc,
                     uint32_t gamut, uint32_t alarm_rgb) {
    if (!begin()) return 0;
    if (mode > 1 || intent > 3 || proof_intent > 3 || bpc > 1 || gamut > 1 || alarm_rgb > 0xffffff)
        return fail("Invalid ICC transform settings.");
    if (!mode && gamut) return fail("Gamut alarms require a proofing transform.");
    cmsHPROFILE profile = open_profile(bytes, length);
    if (!profile) return 0;
    describe(profile);
    const auto kind = cmsGetDeviceClass(profile);
    if (kind != cmsSigInputClass && kind != cmsSigDisplayClass && kind != cmsSigOutputClass && kind != cmsSigColorSpaceClass) {
        cmsCloseProfile(profile);
        return fail("This ICC profile class cannot be used as an output device.");
    }
    if (!mode && cmsGetColorSpace(profile) != cmsSigRgbData) {
        cmsCloseProfile(profile);
        return fail("RGB delivery requires an RGB output profile.");
    }
    // cmsIsIntentSupported describes explicit tables/matrix support. Valid LUT
    // profiles may omit an intent table and rely on the CMM's standard fallback.
    // Transform creation is authoritative; the host discloses that fallback.
    cmsHPROFILE srgb = cmsCreate_sRGBProfileTHR(context);
    if (!srgb) { cmsCloseProfile(profile); return fail("sRGB source profile allocation failed."); }
    cmsUInt32Number flags = cmsFLAGS_COPY_ALPHA | cmsFLAGS_HIGHRESPRECALC;
    if (bpc) flags |= cmsFLAGS_BLACKPOINTCOMPENSATION;
    if (mode) {
        flags |= cmsFLAGS_SOFTPROOFING;
        if (gamut) {
            flags |= cmsFLAGS_GAMUTCHECK;
            cmsUInt16Number alarms[cmsMAXCHANNELS] = {};
            alarms[0] = ((alarm_rgb >> 16) & 255) * 257;
            alarms[1] = ((alarm_rgb >> 8) & 255) * 257;
            alarms[2] = (alarm_rgb & 255) * 257;
            cmsSetAlarmCodesTHR(context, alarms);
        }
        transform = cmsCreateProofingTransformTHR(context, srgb, TYPE_RGBA_8, srgb, TYPE_RGBA_8, profile, intent, proof_intent, flags);
    } else {
        transform = cmsCreateTransformTHR(context, srgb, TYPE_RGBA_8, profile, TYPE_RGBA_8, intent, flags);
    }
    // Transforms own their compiled pipelines; source profile handles can close.
    cmsCloseProfile(srgb);
    cmsCloseProfile(profile);
    if (!transform) return 0;
    return 1;
}
int canoli_icc_apply(const uint8_t* input, uint8_t* output, uint32_t pixels) {
    if (!transform || input_format || output_format || !input || !output || !pixels || uint64_t(pixels) * 4 > uint64_t(std::numeric_limits<ptrdiff_t>::max()))
        return fail("Invalid ICC RGBA8 pixel window.");
    message[0] = 0;
    failed = false;
    cmsDoTransform(transform, input, output, pixels);
    return failed ? 0 : 1;
}
// Explicit RGB source/destination, straight alpha; formats: 0=uint8, 1=uint16,
// 2=float32. These are sample windows, independent of document geometry.
int canoli_icc_begin_rgb(const uint8_t* source, uint32_t source_length,
                        const uint8_t* destination, uint32_t destination_length,
                        uint32_t input, uint32_t output, uint32_t intent, uint32_t bpc) {
    if (!begin()) return 0;
    if (input > 2 || output > 2 || intent > 3 || bpc > 1) return fail("Invalid RGB ICC pipeline settings.");
    cmsHPROFILE from = open_profile(source, source_length);
    if (!from) return 0;
    cmsHPROFILE to = open_profile(destination, destination_length);
    if (!to) { cmsCloseProfile(from); return 0; }
    if (!rgb_profile(from) || !rgb_profile(to)) {
        cmsCloseProfile(from); cmsCloseProfile(to);
        return fail("ICC sample conversion requires RGB input and output profiles.");
    }
    cmsUInt32Number flags = cmsFLAGS_COPY_ALPHA | cmsFLAGS_HIGHRESPRECALC;
    if (bpc) flags |= cmsFLAGS_BLACKPOINTCOMPENSATION;
    transform = cmsCreateTransformTHR(context, from, pixel_type(input), to, pixel_type(output), intent, flags);
    cmsCloseProfile(from); cmsCloseProfile(to);
    if (!transform || failed) { if (transform) cmsDeleteTransform(transform); transform = nullptr; return 0; }
    input_format = input; output_format = output;
    return 1;
}
// Explicit RGB input/display profiles with an independent RGB/CMYK proof device.
// The float input goes directly to the CMM, including its native gamut check.
int canoli_icc_begin_proof(const uint8_t* source, uint32_t source_length,
                          const uint8_t* destination, uint32_t destination_length,
                          const uint8_t* device, uint32_t device_length,
                          uint32_t input, uint32_t output, uint32_t intent,
                          uint32_t proof_intent, uint32_t bpc, uint32_t gamut, uint32_t alarm_rgb) {
    if (!begin()) return 0;
    if (input > 2 || output > 2 || intent > 3 || proof_intent > 3 || bpc > 1 || gamut > 1 || alarm_rgb > 0xffffff)
        return fail("Invalid explicit ICC proof settings.");
    cmsHPROFILE from = open_profile(source, source_length);
    if (!from) return 0;
    cmsHPROFILE to = open_profile(destination, destination_length);
    if (!to) { cmsCloseProfile(from); return 0; }
    cmsHPROFILE proof = open_profile(device, device_length);
    if (!proof) { cmsCloseProfile(from); cmsCloseProfile(to); return 0; }
    const auto kind = cmsGetDeviceClass(proof);
    const auto space = cmsGetColorSpace(proof);
    const bool device_ok = (kind == cmsSigInputClass || kind == cmsSigDisplayClass || kind == cmsSigOutputClass || kind == cmsSigColorSpaceClass) &&
        (space == cmsSigRgbData || space == cmsSigCmykData);
    if (!rgb_profile(from) || !rgb_profile(to) || !device_ok) {
        cmsCloseProfile(from); cmsCloseProfile(to); cmsCloseProfile(proof);
        return fail("ICC proofing requires RGB source/display profiles and an RGB or CMYK device profile.");
    }
    cmsUInt32Number flags = cmsFLAGS_COPY_ALPHA | cmsFLAGS_HIGHRESPRECALC | cmsFLAGS_SOFTPROOFING;
    if (bpc) flags |= cmsFLAGS_BLACKPOINTCOMPENSATION;
    if (gamut) {
        flags |= cmsFLAGS_GAMUTCHECK;
        cmsUInt16Number alarms[cmsMAXCHANNELS] = {};
        alarms[0] = ((alarm_rgb >> 16) & 255) * 257;
        alarms[1] = ((alarm_rgb >> 8) & 255) * 257;
        alarms[2] = (alarm_rgb & 255) * 257;
        cmsSetAlarmCodesTHR(context, alarms);
    }
    transform = cmsCreateProofingTransformTHR(context, from, pixel_type(input), to, pixel_type(output), proof, intent, proof_intent, flags);
    cmsCloseProfile(from); cmsCloseProfile(to); cmsCloseProfile(proof);
    if (!transform || failed) { if (transform) cmsDeleteTransform(transform); transform = nullptr; return 0; }
    input_format = input; output_format = output;
    return 1;
}
int canoli_icc_apply_window(const void* input, void* output, uint32_t pixels) {
    const uint32_t stride = 4u << (input_format > output_format ? input_format : output_format);
    if (!transform || !input || !output || !pixels || uint64_t(pixels) * stride > uint64_t(std::numeric_limits<ptrdiff_t>::max()))
        return fail("Invalid ICC sample window.");
    if (input_format == 2 && !finite_window(input, pixels)) return fail("ICC float input must be finite with alpha in [0,1].");
    message[0] = 0; failed = false;
    cmsDoTransform(transform, input, output, pixels);
    if (failed) return 0;
    if (output_format == 2 && !finite_window(output, pixels)) return fail("ICC float output is not finite or has invalid alpha.");
    return 1;
}
}

#include <libraw/libraw.h>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <memory>
#include <new>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
EM_JS(void, notify_raw_progress, (int stage, int iteration, int expected), {
    if (Module['canoliRawProgress']) Module['canoliRawProgress'](stage, iteration, expected);
});
#else
static void notify_raw_progress(int, int, int) {}
#endif

// One module per private worker. The only retained plane is owned linear RGB16.
static uint8_t *output = nullptr;
static uint32_t info[32] = {};
static char texts[7][256] = {};
static char error_message[1024] = {};

class CheckedRaw final : public LibRaw {
public:
    bool has_extra_samples() {
        const auto count = libraw_internal_data.identify_data.tiff_nifds;
        const auto offset = libraw_internal_data.unpacker_data.data_offset;
        for (unsigned i = 0; i < count && i < LIBRAW_IFD_MAXCOUNT; i++)
            if (tiff_ifd[i].offset == offset && tiff_ifd[i].extrasamples > 0) return true;
        return false;
    }
    bool geometry_representable() {
        // Public size fields are uint16. Reject a selected TIFF extent before
        // accepting any silent narrowing from its wider parsed dimensions.
        const auto count = libraw_internal_data.identify_data.tiff_nifds;
        const auto offset = libraw_internal_data.unpacker_data.data_offset;
        for (unsigned i = 0; i < count && i < LIBRAW_IFD_MAXCOUNT; i++) {
            const auto &item = tiff_ifd[i];
            if (item.offset == offset && (item.t_width > 65535 || item.t_height > 65535)) return false;
        }
        const auto &s = imgdata.sizes;
        const double fuji = is_fuji_rotated(),aspect = s.pixel_aspect;
        if (!std::isfinite(aspect) || aspect <= 0) return false;
        const double width = fuji ? (fuji - 1) / std::sqrt(0.5) : s.width * (aspect > 1.005 ? aspect : 1);
        const double height = fuji ? (s.height - fuji) / std::sqrt(0.5) : s.height / (aspect < 0.995 ? aspect : 1);
        return width > 0 && height > 0 && width <= 65535 && height <= 65535;
    }
};

static int progress(void *, enum LibRaw_progress stage, int iteration, int expected) {
    notify_raw_progress(int(stage), iteration, expected);
    return 0;
}
static int fail(const char *phase, int status) {
    std::snprintf(error_message, sizeof(error_message), "RAW %s failed: %s (%d).", phase, libraw_strerror(status), status);
    return status ? status : -1;
}
static bool finite_between(double value, double low, double high) {
    return std::isfinite(value) && value >= low && value <= high;
}
static bool representable(uint32_t width, uint32_t height, uint32_t bytes) {
    return width && height && uint64_t(width) * height * bytes <= uint64_t(std::numeric_limits<ptrdiff_t>::max());
}

extern "C" {
void canoli_raw_release() {
    std::free(output); output = nullptr;
    std::memset(info, 0, sizeof(info));
    std::memset(texts, 0, sizeof(texts));
}
const uint32_t *canoli_raw_info() { return info; }
const uint8_t *canoli_raw_pixels() { return output; }
const char *canoli_raw_text(uint32_t index) { return index < 7 ? texts[index] : nullptr; }
const char *canoli_raw_error() { return error_message; }

int canoli_raw_process(const uint8_t *bytes, size_t length, int mode, uint32_t shot,
                      int wb, int quality, int highlight, double ev, double preserve,
                      double red, double green, double blue) {
    canoli_raw_release(); error_message[0] = 0;
    if (!bytes || !length || (mode != 0 && mode != 1) || wb < 0 || wb > 3 ||
        (quality != 0 && quality != 1 && quality != 2 && quality != 3 && quality != 4 && quality != 11 && quality != 12) ||
        highlight < 0 || highlight > 9 || !finite_between(ev, -2, 3) || !finite_between(preserve, 0, 1) ||
        !finite_between(red, 0.01, 64) || !finite_between(green, 0.01, 64) || !finite_between(blue, 0.01, 64)) {
        std::snprintf(error_message, sizeof(error_message), "Invalid RAW source or development options."); return -1;
    }
    try {
        auto decoder = std::make_unique<CheckedRaw>();
        auto &data = decoder->imgdata;
        data.rawparams.shot_select = shot;
        // Optional working-memory defaults do not define source image limits.
        // Native overflow/representation checks and actual allocation remain.
        data.rawparams.max_raw_memory_mb = std::numeric_limits<unsigned>::max();
        data.params.output_bps = 16;
        data.params.output_color = 1;
        data.params.gamm[0] = data.params.gamm[1] = 1.0;
        data.params.no_auto_bright = 1;
        data.params.adjust_maximum_thr = 0;
        data.params.use_camera_matrix = 1;
        data.params.use_camera_wb = wb == 0;
        data.params.use_auto_wb = wb == 1;
        if (wb == 3) {
            data.params.user_mul[0] = float(red); data.params.user_mul[1] = float(green);
            data.params.user_mul[2] = float(blue); data.params.user_mul[3] = float(green);
        }
        data.params.user_qual = quality; data.params.highlight = highlight;
        data.params.exp_correc = ev != 0;
        data.params.exp_shift = float(std::exp2(ev)); data.params.exp_preser = float(preserve);
        decoder->set_progress_handler(progress, nullptr);
        int status = decoder->open_buffer(const_cast<uint8_t *>(bytes), length);
        if (status) return fail("inspection", status);
        if (!decoder->geometry_representable()) {
            std::snprintf(error_message, sizeof(error_message), "RAW source geometry exceeds the native dimension representation."); return -11;
        }
        if (!data.idata.raw_count || shot >= data.idata.raw_count) {
            std::snprintf(error_message, sizeof(error_message), "RAW image selection is outside the source."); return -2;
        }
        int width = 0, height = 0, colors = 0, bits = 0;
        decoder->get_mem_image_format(&width, &height, &colors, &bits);
        auto &s = data.sizes;
        if (!s.raw_width || !s.raw_height || width <= 0 || height <= 0 || data.idata.colors < 1 || data.idata.colors > 4) {
            std::snprintf(error_message, sizeof(error_message), "Invalid RAW native geometry or channels."); return -3;
        }
        bool camera_wb = true;
        for (int i = 0; i < 3; i++) camera_wb = camera_wb && std::isfinite(data.color.cam_mul[i]) && data.color.cam_mul[i] > 0;
        bool finite_matrix = true; double matrix_energy = 0;
        for (const auto &row : data.color.rgb_cam) for (float value : row) {
            finite_matrix = finite_matrix && std::isfinite(value); matrix_energy += std::abs(double(value));
        }
        const bool calibrated = data.idata.colors == 1 ||
            (!decoder->get_internal_data_pointer()->internal_output_params.raw_color && finite_matrix && matrix_energy > 0);
        info[0] = 2; info[1] = s.raw_width; info[2] = s.raw_height;
        info[3] = s.width; info[4] = s.height; info[5] = uint32_t(width); info[6] = uint32_t(height);
        info[7] = uint32_t(s.flip); info[8] = data.idata.raw_count; info[9] = shot;
        info[10] = data.idata.filters; info[11] = data.idata.colors; info[12] = data.idata.dng_version;
        info[13] = data.idata.is_foveon; info[14] = data.process_warnings;
        info[19] = camera_wb; info[20] = calibrated; info[21] = data.color.raw_bps;
        info[22] = data.color.maximum; info[23] = data.color.black;
        info[25] = decoder->has_extra_samples();
        // Recorded EXIF/makernote values are declarations, not calibrated sensor
        // geometry. Invalid/missing numeric metadata uses the zero wire sentinel.
        const auto positive = [](float primary, float fallback = 0.0f) {
            return std::isfinite(primary) && primary > 0 ? primary :
                std::isfinite(fallback) && fallback > 0 ? fallback : 0.0f;
        };
        const float shooting[] = {
            positive(data.other.focal_len, data.lens.makernotes.CurFocal),
            positive(float(data.lens.FocalLengthIn35mmFormat), data.lens.makernotes.FocalLengthIn35mmFormat),
            positive(data.other.aperture, data.lens.makernotes.CurAp),
            positive(data.other.shutter), positive(data.other.iso_speed)
        };
        static_assert(sizeof(float) == sizeof(uint32_t), "RAW protocol requires 32-bit floats");
        std::memcpy(info + 26, shooting, sizeof(shooting));
        std::snprintf(texts[0], sizeof(texts[0]), "%.*s", int(sizeof(data.idata.make)), data.idata.make);
        std::snprintf(texts[1], sizeof(texts[1]), "%.*s", int(sizeof(data.idata.model)), data.idata.model);
        const char *decoder_name = decoder->unpack_function_name();
        std::snprintf(texts[2], sizeof(texts[2]), "%s", decoder_name ? decoder_name : "unknown");
        std::snprintf(texts[3], sizeof(texts[3]), "%s", LibRaw::version());
        std::snprintf(texts[4], sizeof(texts[4]), "%.*s", int(sizeof(data.idata.cdesc)), data.idata.cdesc);
        std::snprintf(texts[5], sizeof(texts[5]), "%.*s", int(sizeof(data.lens.LensMake)), data.lens.LensMake);
        const bool named_lens = data.lens.Lens[0] != 0;
        std::snprintf(texts[6], sizeof(texts[6]), "%.*s",
            int(named_lens ? sizeof(data.lens.Lens) : sizeof(data.lens.makernotes.Lens)),
            named_lens ? data.lens.Lens : data.lens.makernotes.Lens);
        if (mode == 0) return 0;
        if (info[25]) {
            std::snprintf(error_message, sizeof(error_message), "RAW extra sample channels require a preserved-coverage development pipeline."); return -13;
        }
        if (!calibrated) {
            std::snprintf(error_message, sizeof(error_message), "RAW camera color calibration is unavailable; uncalibrated channels cannot be identified as sRGB."); return -4;
        }
        if (wb == 0 && !camera_wb && data.idata.colors > 1) {
            std::snprintf(error_message, sizeof(error_message), "Camera-recorded RAW white balance is unavailable. Choose Auto, Daylight or Custom."); return -5;
        }
        if (!representable(s.raw_width, s.raw_height, 8) || !representable(width, height, 8)) {
            std::snprintf(error_message, sizeof(error_message), "RAW geometry exceeds the native pointer-difference representation."); return -6;
        }
        if (data.idata.colors == 1) data.params.use_camera_wb = data.params.use_auto_wb = 0;
        status = decoder->unpack();
        if (status) return fail("sensor unpacking", status);
        if (decoder->error_count()) {
            std::snprintf(error_message, sizeof(error_message), "RAW sensor data is incomplete or corrupt."); return -12;
        }
        status = decoder->dcraw_process();
        if (status) return fail("development", status);
        if (decoder->error_count()) {
            std::snprintf(error_message, sizeof(error_message), "RAW development encountered corrupt source data."); return -12;
        }
        decoder->get_mem_image_format(&width, &height, &colors, &bits);
        if ((colors != 1 && colors != 3) || bits != 16 || !representable(width, height, colors * 2)) {
            std::snprintf(error_message, sizeof(error_message), "Invalid RAW developed pixel representation."); return -7;
        }
        const size_t output_length = size_t(width) * height * colors * 2;
        output = static_cast<uint8_t *>(std::calloc(output_length, 1));
        if (!output) { std::snprintf(error_message, sizeof(error_message), "RAW developed pixel allocation failed."); return -8; }
        // The upstream make_mem_image helper ignores copy_mem_image's status.
        // Own and validate that copy explicitly instead of accepting false pixels.
        status = decoder->copy_mem_image(output, width * colors * 2, 0);
        if (status) { canoli_raw_release(); return fail("pixel copy", status); }
        info[5] = width; info[6] = height; info[14] = data.process_warnings;
        info[15] = uint32_t(output_length); info[16] = 16; info[17] = colors; info[18] = 1;
        return 0;
    } catch (const std::bad_alloc &) {
        canoli_raw_release(); std::snprintf(error_message, sizeof(error_message), "RAW native allocation failed."); return -9;
    } catch (...) {
        canoli_raw_release(); std::snprintf(error_message, sizeof(error_message), "RAW native processing failed unexpectedly."); return -10;
    }
}
}

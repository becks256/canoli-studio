#include <avif/avif.h>
#include <cstdint>
#include <cstdio>
#include <limits>

// A module belongs to one private import worker. No shared memory or threads.
static avifRGBImage output = {};
static uint32_t info[12] = {};
static char error_message[1024] = {};

extern "C" {
void canoli_avif_release() {
    avifRGBImageFreePixels(&output);
    output = {};
    for (uint32_t &field : info) field = 0;
}

const uint32_t *canoli_avif_info() { return info; }
const char *canoli_avif_error() { return error_message; }

int canoli_avif_decode(const uint8_t *bytes, size_t length) {
    canoli_avif_release();
    error_message[0] = 0;
    if (!bytes || !length) {
        std::snprintf(error_message, sizeof(error_message), "AVIF source is empty.");
        return -1;
    }
    avifDecoder *decoder = avifDecoderCreate();
    avifImage *image = nullptr; // borrowed from the decoder after successful parsing
    if (!decoder) {
        std::snprintf(error_message, sizeof(error_message), "AVIF decoder allocation failed.");
        return -2;
    }
    decoder->maxThreads = 1;
    // Remove libavif's optional default 32768-axis/268 MP guards. uint32 pixel
    // representation, the WASM address space and real allocation remain limits.
    decoder->imageDimensionLimit = 0;
    decoder->imageSizeLimit = std::numeric_limits<uint32_t>::max();
    decoder->ignoreExif = AVIF_TRUE;
    decoder->ignoreXMP = AVIF_TRUE;
    avifResult result = avifDecoderSetSource(decoder, AVIF_DECODER_SOURCE_PRIMARY_ITEM);
    const char *phase = "primary-item selection";
    if (result == AVIF_RESULT_OK) {
        phase = "input attachment";
        result = avifDecoderSetIOMemory(decoder, bytes, length);
    }
    if (result == AVIF_RESULT_OK) {
        phase = "native parsing";
        result = avifDecoderParse(decoder);
    }
    if (result == AVIF_RESULT_OK) {
        image = decoder->image;
        const uint64_t expected = uint64_t(image->width) * image->height * 4;
        if (!image->width || !image->height || expected > uint64_t(std::numeric_limits<ptrdiff_t>::max())) {
            std::snprintf(error_message, sizeof(error_message), "AVIF RGBA geometry exceeds the native pointer-difference representation.");
            avifDecoderDestroy(decoder);
            return -3;
        }
    }
    if (result == AVIF_RESULT_OK) {
        phase = "native decoding";
        result = avifDecoderNextImage(decoder);
        image = decoder->image;
    }
    if (result == AVIF_RESULT_OK) {
        avifRGBImageSetDefaults(&output, image);
        output.depth = 8;
        output.format = AVIF_RGB_FORMAT_RGBA;
        output.chromaUpsampling = AVIF_CHROMA_UPSAMPLING_BILINEAR;
        output.avoidLibYUV = AVIF_TRUE;
        output.alphaPremultiplied = AVIF_FALSE;
        output.maxThreads = 1;
        phase = "RGBA allocation";
        result = avifRGBImageAllocatePixels(&output);
    }
    if (result == AVIF_RESULT_OK) {
        phase = "YUV/RGB conversion";
        result = avifImageYUVToRGB(image, &output);
    }
    if (result != AVIF_RESULT_OK) {
        std::snprintf(error_message, sizeof(error_message), "AVIF %s failed: %s. %s",
                      phase, avifResultToString(result), decoder->diag.error);
        canoli_avif_release();
    } else {
        const uint64_t expected = uint64_t(image->width) * image->height * 4;
        if (!output.pixels || output.rowBytes != uint64_t(image->width) * 4 ||
            expected > std::numeric_limits<size_t>::max()) {
            std::snprintf(error_message, sizeof(error_message), "AVIF RGBA extent exceeds the native address representation.");
            canoli_avif_release();
            result = AVIF_RESULT_INVALID_ARGUMENT;
        } else {
            info[0] = 1;
            info[1] = image->width;
            info[2] = image->height;
            info[3] = image->depth;
            info[4] = image->alphaPlane ? 1 : 0;
            info[5] = image->colorPrimaries;
            info[6] = image->transferCharacteristics;
            info[7] = image->matrixCoefficients;
            info[8] = image->yuvRange == AVIF_RANGE_FULL ? 1 : 0;
            info[9] = uint32_t(reinterpret_cast<uintptr_t>(output.pixels));
            info[10] = uint32_t(expected);
            info[11] = output.rowBytes;
        }
    }
    avifDecoderDestroy(decoder);
    return int(result);
}
}

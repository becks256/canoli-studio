#include <woff2/decode.h>
#include <woff2/output.h>
#include <cstdint>
#include <limits>
#include <string>

extern "C" {
std::string* canoli_woff2_decode(const uint8_t* input, uint32_t length) {
  auto* result = new std::string();
  woff2::WOFF2StringOut writer(result);
  // Allocation is bounded by the WASM address space and host job lifetime,
  // independently of the source font's original table geometry.
  writer.SetMaxSize(std::numeric_limits<size_t>::max());
  if (!woff2::ConvertWOFF2ToTTF(input, length, &writer)) {
    delete result;
    return nullptr;
  }
  return result;
}
const uint8_t* canoli_font_data(const std::string* result) {
  return reinterpret_cast<const uint8_t*>(result->data());
}
uint32_t canoli_font_size(const std::string* result) {
  return static_cast<uint32_t>(result->size());
}
void canoli_font_release(std::string* result) { delete result; }
}

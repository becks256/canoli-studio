cmake_minimum_required(VERSION 3.31)
project(canoli_avif_decoder LANGUAGES C CXX)
if(NOT EMSCRIPTEN OR NOT CANOLI_AVIF_SOURCE)
  message(FATAL_ERROR "Use emcmake and set CANOLI_AVIF_SOURCE to the pinned libavif checkout.")
endif()
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(AVIF_CODEC_AOM LOCAL CACHE STRING "" FORCE)
set(AVIF_CODEC_AOM_ENCODE OFF CACHE BOOL "" FORCE)
set(AVIF_CODEC_AOM_DECODE ON CACHE BOOL "" FORCE)
set(AVIF_CODEC_DAV1D OFF CACHE STRING "" FORCE)
set(AVIF_CODEC_LIBGAV1 OFF CACHE STRING "" FORCE)
set(AVIF_CODEC_RAV1E OFF CACHE STRING "" FORCE)
set(AVIF_CODEC_SVT OFF CACHE STRING "" FORCE)
set(AVIF_LIBYUV OFF CACHE STRING "" FORCE)
set(AVIF_LIBSHARPYUV OFF CACHE STRING "" FORCE)
set(AVIF_BUILD_APPS OFF CACHE BOOL "" FORCE)
set(AVIF_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(AOM_TARGET_CPU generic CACHE STRING "" FORCE)
set(CONFIG_RUNTIME_CPU_DETECT 0 CACHE STRING "" FORCE)
set(CONFIG_MULTITHREAD 0 CACHE STRING "" FORCE)
set(FETCHCONTENT_SOURCE_DIR_LIBAOM "${CANOLI_AVIF_SOURCE}/ext/aom" CACHE PATH "" FORCE)
add_subdirectory("${CANOLI_AVIF_SOURCE}" libavif)
# libavif 1.3 rejects imageSizeLimit values above its optional default before
# parsing. Permit the native uint32 field range; retain all dimension division,
# per-plane/PTRDIFF allocation checks, and the wrapper's pre-decode RGBA check.
file(READ "${CANOLI_AVIF_SOURCE}/src/read.c" CANOLI_AVIF_READ)
set(CANOLI_OLD_GUARD "(decoder->imageSizeLimit > AVIF_DEFAULT_IMAGE_SIZE_LIMIT) || (decoder->imageSizeLimit == 0)")
string(FIND "${CANOLI_AVIF_READ}" "${CANOLI_OLD_GUARD}" CANOLI_GUARD_AT)
if(CANOLI_GUARD_AT LESS 0)
  message(FATAL_ERROR "Pinned libavif size guard changed; review the patch before building.")
endif()
string(REPLACE "${CANOLI_OLD_GUARD}" "decoder->imageSizeLimit == 0" CANOLI_AVIF_READ "${CANOLI_AVIF_READ}")
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/canoli_avif_read.c" "${CANOLI_AVIF_READ}")
set_source_files_properties("${CANOLI_AVIF_SOURCE}/src/read.c" TARGET_DIRECTORY avif_obj PROPERTIES HEADER_FILE_ONLY TRUE)
target_sources(avif_obj PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/canoli_avif_read.c")
add_executable(canoli_avif_decoder decoder.cpp)
target_link_libraries(canoli_avif_decoder PRIVATE avif)
target_compile_options(canoli_avif_decoder PRIVATE -O3 -fno-exceptions)
target_link_options(canoli_avif_decoder PRIVATE
  -O3 --no-entry
  "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sEXPORT_NAME=createCanoliAvifDecoder"
  "-sENVIRONMENT=web,worker,node" "-sFILESYSTEM=0" "-sALLOW_MEMORY_GROWTH=1"
  "-sMAXIMUM_MEMORY=4294967296" "-sINITIAL_MEMORY=16777216" "-sSTACK_SIZE=1048576"
  "-sEXPORTED_FUNCTIONS=['_malloc','_free','_canoli_avif_decode','_canoli_avif_release','_canoli_avif_info','_canoli_avif_error']"
  "-sEXPORTED_RUNTIME_METHODS=['HEAPU8']")
set_target_properties(canoli_avif_decoder PROPERTIES SUFFIX ".js")

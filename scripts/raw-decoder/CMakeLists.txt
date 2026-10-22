cmake_minimum_required(VERSION 3.31)
project(canoli_raw_decoder LANGUAGES C CXX)
if(NOT CANOLI_RAW_SOURCE OR NOT CANOLI_ZLIB_SOURCE OR NOT CANOLI_RAW_SOURCES_FILE)
  message(FATAL_ERROR "Provide the pinned LibRaw/zlib sources and generated source list.")
endif()
set(CMAKE_CXX_STANDARD 17)
set(ZLIB_BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(ZLIB_BUILD_SHARED OFF CACHE BOOL "" FORCE)
set(ZLIB_BUILD_STATIC ON CACHE BOOL "" FORCE)
set(ZLIB_INSTALL OFF CACHE BOOL "" FORCE)
add_subdirectory("${CANOLI_ZLIB_SOURCE}" zlib)
include("${CANOLI_RAW_SOURCES_FILE}")
add_library(canoli_libraw STATIC ${CANOLI_RAW_SOURCES})
target_include_directories(canoli_libraw PUBLIC "${CANOLI_RAW_SOURCE}")
target_compile_definitions(canoli_libraw PUBLIC LIBRAW_NOTHREADS USE_ZLIB USE_X3FTOOLS)
target_link_libraries(canoli_libraw PUBLIC zlibstatic)
target_compile_options(canoli_libraw PRIVATE -O3 -fexceptions)
if(EMSCRIPTEN)
  add_executable(canoli_raw_decoder decoder.cpp)
  target_link_libraries(canoli_raw_decoder PRIVATE canoli_libraw)
  target_compile_options(canoli_raw_decoder PRIVATE -O3 -fexceptions)
  target_link_options(canoli_raw_decoder PRIVATE -O3 --no-entry
    "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sEXPORT_NAME=createCanoliRawDecoder"
    "-sENVIRONMENT=web,worker,node" "-sFILESYSTEM=0" "-sALLOW_MEMORY_GROWTH=1"
    "-sMAXIMUM_MEMORY=4294967296" "-sINITIAL_MEMORY=16777216" "-sSTACK_SIZE=2097152"
    "-sDISABLE_EXCEPTION_CATCHING=0" "-sABORTING_MALLOC=0"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_canoli_raw_process','_canoli_raw_info','_canoli_raw_pixels','_canoli_raw_text','_canoli_raw_error','_canoli_raw_release']"
    "-sEXPORTED_RUNTIME_METHODS=['HEAPU8']")
  set_target_properties(canoli_raw_decoder PROPERTIES SUFFIX ".js")
else()
  # Independent native reference: the maintained upstream sample, not our ABI.
  add_executable(dcraw_emu "${CANOLI_RAW_SOURCE}/samples/dcraw_emu.cpp")
  target_link_libraries(dcraw_emu PRIVATE canoli_libraw)
endif()

cmake_minimum_required(VERSION 3.16)
project(canoli_icc LANGUAGES C CXX)
if(NOT EMSCRIPTEN OR NOT CANOLI_LCMS_SOURCE)
 message(FATAL_ERROR "Use emcmake and the pinned CANOLI_LCMS_SOURCE checkout.")
endif()
# Core MIT engine only. Optional third-party/GPL plugins are not built.
file(GLOB CANOLI_LCMS_CORE CONFIGURE_DEPENDS "${CANOLI_LCMS_SOURCE}/src/*.c")
add_library(canoli_lcms STATIC ${CANOLI_LCMS_CORE})
target_include_directories(canoli_lcms PUBLIC "${CANOLI_LCMS_SOURCE}/include")
target_compile_options(canoli_lcms PRIVATE -O3)
add_executable(canoli_icc engine.cpp)
target_link_libraries(canoli_icc PRIVATE canoli_lcms)
target_compile_options(canoli_icc PRIVATE -O3 -fno-exceptions)
target_link_options(canoli_icc PRIVATE
 -O3 --no-entry
 "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sEXPORT_NAME=createCanoliIcc"
 "-sENVIRONMENT=web,worker,node" "-sFILESYSTEM=0" "-sALLOW_MEMORY_GROWTH=1"
 "-sMAXIMUM_MEMORY=4294967296" "-sINITIAL_MEMORY=16777216" "-sSTACK_SIZE=1048576"
 "-sEXPORTED_FUNCTIONS=['_malloc','_free','_canoli_icc_close','_canoli_icc_error','_canoli_icc_info','_canoli_icc_text','_canoli_icc_version','_canoli_icc_inspect','_canoli_icc_begin','_canoli_icc_apply','_canoli_icc_begin_rgb','_canoli_icc_begin_proof','_canoli_icc_apply_window']"
 "-sEXPORTED_RUNTIME_METHODS=['HEAPU8']")
set_target_properties(canoli_icc PROPERTIES SUFFIX ".js")

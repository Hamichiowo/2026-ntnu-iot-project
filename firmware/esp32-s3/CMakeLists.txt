cmake_minimum_required(VERSION 3.22)
set(COMPONENTS main)
# Shown on the dashboard. Bump it for each release; the server tells images apart by their ELF hash.
set(PROJECT_VER "0.4.0")
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(hx711_scale)

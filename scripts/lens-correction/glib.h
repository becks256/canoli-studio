#pragma once
// Compatibility surface used by the selected Lensfun correction translation
// units. No GLib parser, filesystem, locale, object or container service exists.
#include <cstdlib>
typedef char gchar;
typedef unsigned char guchar;
typedef int gint;
typedef unsigned int guint;
typedef unsigned int guint32;
struct GString;
struct GPtrArray;
extern "C" void g_warning(const char *, ...);

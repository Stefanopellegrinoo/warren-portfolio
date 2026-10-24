import { z } from 'zod'

// Messages reach the user verbatim: Spanish defaults for any issue a schema gives no message of its own.
// Imported for its effect by every module that parses user input (z.config is process-wide).
z.config(z.locales.es())

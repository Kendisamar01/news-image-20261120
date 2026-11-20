Make.fun news-image-20261120 entry
This entry provides the supplied 1024x1024 newspaper front page PNG.
main.ts reads entry.png relative to the repository root.
It validates the PNG signature, chunk structure, and CRC-32 values.
It rejects PNGs whose width or height exceeds 1024 pixels.
The output directory is set with MAKEFUN_OUTPUT_DIR, defaulting to out.
Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

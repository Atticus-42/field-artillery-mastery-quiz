# Field Artillery Mastery Quiz

This repository builds a dependency-free static quiz page. The question banks are JSON files in `src/questions/`; `src/template.html` is the HTML source.

Run `node scripts/verify.mjs` to check the build and question schema. Run `node scripts/build.mjs` to generate `index.html` for static hosting. Neither command requires package installation.

Each bank is an array of questions numbered from 1. A question has integer `id`, its bank `difficulty`, nonempty string `category`, `prompt`, and `explanation`, string arrays `tags` and four `options`, zero-based integer `answer` (0–3), and an integer array `sourceSlides` (slides 15–38). The banks are initially empty so later content work can populate them.

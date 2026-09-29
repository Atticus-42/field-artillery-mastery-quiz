# Field Artillery Mastery Quiz

A free, browser-based practice aid for the *Field Artillery Operations* lesson. Once deployed, students can take a 25-question Easy, Medium, or Hard examination at [the public website](https://atticus-42.github.io/field-artillery-mastery-quiz/). The study confirmation must be checked before any examination starts. This quiz does not replace studying the complete lesson.

Questions use only the substantive content of slides 15–38 of the supplied *Field Artillery Operations* PDF. Instructor and classroom material, safety reminders, objectives, assessment directions, and presentation administration are outside the question source boundary. Scenarios are fictional Philippine Army situations grounded in those lesson slides, not claims about historical events.

The site requires no login or payment. It has no analytics, cookies, advertising, external fonts, images, scripts, or runtime libraries. Answers and scores stay in browser memory; they are not transmitted or stored remotely and disappear on refresh or close.

`src/questions/` contains the three authored question banks, `src/template.html` contains the page source, and `scripts/build.mjs` generates the self-contained `index.html`. Run the complete local test gate from the repository root:

```sh
node scripts/build.mjs && node scripts/verify.mjs && git diff --check
```

No package installation is required. GitHub Pages deploys `index.html` from the root of the `main` branch to `https://atticus-42.github.io/field-artillery-mastery-quiz/`.

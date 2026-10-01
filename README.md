# Field Artillery Mastery Quiz

A free, browser-based practice aid for the *Field Artillery Operations* lesson. Students enter a name, confirm the study warning, and take a 25-question Easy, Medium, or Hard examination at https://atticus-42.github.io/field-artillery-mastery-quiz/. Questions are reshuffled on every attempt. This quiz does not replace studying the complete lesson.

Questions use only the substantive content of slides 15-38 of the supplied *Field Artillery Operations* presentation (mission and functions, tactical roles, capabilities and limitations, weapon classification, effects of fires, the Philippine operational environment, the four basic tasks, FA system elements and employment tactics). Instructor and classroom material, safety reminders, objectives, assessment directions and presentation administration are excluded. Scenarios are fictional Philippine Army situations grounded in those slides, not claims about historical events.

No login, payment, analytics, cookies, advertising, external fonts, images, scripts or runtime libraries. Answers stay in browser memory. Only the name, difficulty, score and finish time are sent to the class history Google Sheet (tab "Field Artillery History") through `HISTORY_ENDPOINT` in `src/template.html`.

`src/questions/` holds the three banks, `src/template.html` is the page source, and `scripts/build.mjs` produces the self-contained `index.html`. `apps-script/Code.gs` is the shared history web app (one spreadsheet, one tab per lesson). No package installation is required. Test gate:

```sh
node scripts/build.mjs && node scripts/verify.mjs && git diff --check
```

GitHub Pages deploys `index.html` from the root of the `main` branch.

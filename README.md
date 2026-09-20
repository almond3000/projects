# Projects

My workspace for things I'm building. Each project has its own folder with code, a step-by-step setup log, and a record of the design decisions behind it.

## Projects

| Project | Description | Status |
|---|---|---|
| [App](project-1/) | An app to organize my classes, professor contacts and significant dates. | 🟢 Working on |
| [Drone](project-2/) | A surveillance drone i am attempting to make from scratch. | 🟡 Planning |

## How this repo is organized

```
projects/
├── _template/        # copied by new-project.sh
├── new-project.sh    # ./new-project.sh my-idea
├── project-1/
│   ├── README.md
│   ├── src/
│   └── docs/
│       ├── setup-log.md
│       └── decisions/
└── project-2/
```

## Starting a new project
```bash
./new-project.sh my-new-idea
```
Then add a row to the table above.

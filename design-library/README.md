# Design reference library

An editable shared library for Rocket goals. The index is the catalog; each reference has
Markdown notes and optional local images. Project DESIGN.md files record the direction selected
for that project. The library is read from disk, so catalog and note edits need no rebuild.

## Browse

```sh
npm run design -- list
npm run design -- list productivity
npm run design -- validate
```

Open index.json to browse tags, source URLs, image captions, and paths. Paths in the index are
relative to this folder. Markdown image paths are relative to their Markdown file.

## Add

1. Create `references/<id>/reference.md` with observations, recommended uses, limitations,
   and attribution. Put screenshots in its `images/` subfolder.
2. Copy `templates/entry.json` to a temporary JSON file and replace all example fields.
   Tags are free text; use useful product types, patterns, and visual characteristics.
3. Run `npm run design -- add /absolute/path/to/entry.json`.

Images are optional for link-only candidates. Each image needs `path`, `source`, `caption`,
and `savedAt` (YYYY-MM-DD). Save the original image and distinguish its unknown capture date
from the date you saved it. Never describe an image as inspected until you open it.

## Edit and retire

Edit notes and images directly. For catalog changes, edit index.json and run validation, or
copy the full existing entry into a JSON file, change it, and use:

```sh
npm run design -- edit /absolute/path/to/entry.json
```

The edit command replaces that entry, preserving all other entries. Use the same id. Validation
runs before command writes, including duplicate ids, source URLs, and missing/escaping paths.
Avoid simultaneous catalog edits. Set status to `archived` to retire a reference while keeping
its evidence available to older projects. `candidate` means awaiting review; `reviewed` means
inspected, not automatically approved for every project.

## Grow the collection

Start with references that support real assignments. Suggested coverage: commerce, finance,
education, editorial, portfolios, productivity, and developer tools. Tag patterns independently
(checkout, tables, onboarding, navigation, search, detail-panel) so references can cross verticals.
The library includes Linear and the AI SDK Agents discovery hub. The hub guide describes how
to find task-specific blocks, components, and skills and distinguish public previews from paid
source access. Unresearched categories are not presented as curated references.

## Agent use

The goal draft prompt points to this library and `skills/goal-preparation/SKILL.md`. Agents
select relevant entries, open their images, and explain a coherent direction in the brief.
Existing project guidance and the user's instructions take precedence. Do not load every image
or assume the library's default style is right for every project. Missing library files should
not block a goal. `ROCKET_DESIGN_LIBRARY` can point to another absolute library folder.

This first version is edited through files, commands, or by asking the agent to add a reference;
there is no in-app library editor yet. The schema version is 1.

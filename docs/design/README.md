# Strategy graph UI design

The visual spec for the graph view (plan D14). It is a design canvas:
<https://claude.ai/artifact/381wJ3mBWBE3PY9SWMMNUU>

`mockups/` holds copies of its artboards. They are Design Component files
(`.dc.html`) that render only on the canvas, because they load the canvas runtime
(`./support.js`). Read them for exact sizes, spacing, strokes and states. Don't
port them as code. Their hex colours stand in for Obsidian CSS variables, which
are mapped in the plan's **UI design → Theme** table.

| File | Contents |
|---|---|
| `Main.dc.html` | The assembled graph tab (interactive on the canvas) |
| `Nodes.dc.html` | Node components, all types and states, plus inline editors |
| `Edges.dc.html` | Edge styles and the relation picker |
| `Inspector.dc.html` | Inspector states: bet, assumption, free card |
| `Overlays.dc.html` | Right-click menus, kill-and-activate dialog, hover preview, review walk |

If the canvas changes, re-copy the artboards here in the same commit as the plan update.

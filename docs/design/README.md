# Design references

## Phone layout (plan D22, Phase 8b)

The design canvas is [Strategy Graph — Phone](https://claude.ai/artifact/Sn2dSeQqzRggLQBVoAcMf8).
`phone/` holds copies of its artboards:

| File | Canvas artboard | Contents |
|---|---|---|
| `phone/Portrait.dc.html` | `Main.dc.html`, "Phone · portrait" | Five interactive phones: tap → peek card, details sheet, smells sheet, docked review walk, long-press actions |
| `phone/Landscape.dc.html` | `Landscape.dc.html`, "Phone · landscape" | The same flows with the toolbar as a left rail and every card or sheet on the right |
| `phone/Rules.dc.html` | `Rules.dc.html`, "Phone interaction rules" | Gestures, the two kinds of surface (modal sheet, docked card), zones, insets, toolbar and sizing, React Flow props |

The files are Design Component pages (`.dc.html`). They render only on the canvas, because they load
the canvas runtime (`./support.js`). Read them for layout, sizes and behaviour, not as code to port.
The plan's Phase 8b says which parts are binding and where the mockups' sample data gives way to the
plan's decisions.

If the canvas changes, copy the artboards here again, in the same commit as the matching plan update.

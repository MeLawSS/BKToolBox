# Ethan Monitor Grid Design

## Goal

Add live BidKing monitor awareness to the Ethan page so the page can show the current match's revealed item outlines from hero skill `1002081`.

The first supported live reveal is intentionally narrow:

- Draw a fixed `43 x 10` board on Ethan.
- Start and stop the existing backend Monitor from Ethan's top bar.
- Subscribe to existing Monitor SSE events.
- Use `skillCid=1002081` events to draw item outlines from `hitBoxList[].itemSlotType`.
- Show the revealed item type list from `hitItemTypeNames`.

## Non-Goals

- Do not implement a second packet capture path.
- Do not duplicate the full Monitor settings UI on Ethan.
- Do not infer item quality for `1002081`; this skill only reveals outlines and item types.
- Do not attempt to solve exact item identities from outlines in this change.

## Data Flow

Ethan will reuse the existing backend monitor API:

- `GET /api/bidking-monitor/status`
- `POST /api/bidking-monitor/start`
- `POST /api/bidking-monitor/stop`
- `GET /api/bidking-monitor/events`

On mount, Ethan fetches current monitor status and opens an `EventSource` to `/api/bidking-monitor/events` when supported by the environment. The SSE stream is shared with the Monitor page, so a capture started on either page is visible to both pages.

The top bar switch calls start/stop and then updates local status from the response. The start request uses backend defaults for remote address, port, batch seconds, game root, and output directory. Detailed configuration stays on the Monitor page.

## Board Mapping

The board has 43 rows and 10 columns, for 430 cells.

`boxId` maps to the board in row-major order:

- `boxId=1` is row 1, column 1.
- `boxId=10` is row 1, column 10.
- `boxId=11` is row 2, column 1.

`itemSlotType` is interpreted as a two-digit width/height code:

- `11` -> `1 x 1`
- `21` -> `2 x 1`
- `22` -> `2 x 2`

If a future event contains another valid two-digit code, Ethan may draw it using the same width/height rule. Invalid, out-of-range, or out-of-board placements are listed as warnings and not drawn.

## Rendering

The board is a dense operational panel, not a hero or decorative card. It should sit near the Ethan result area where the live information is useful while estimating.

Each grid cell has stable dimensions and shows its `boxId`. Revealed outlines use neutral styling because `1002081` does not include quality. The outline should visually cover the spanned cells without resizing the board.

Revealed type names are shown in a compact area near the board, for example:

`揭露类型：武器装备 / 家居日用 / ...`

English UI labels are translated, but revealed type names stay as game data in Chinese.

## Event Handling

Ethan only handles Monitor events where `event.skill.skillCid === 1002081`.

For matching events:

- Use `event.gameUid` to detect a new match. A changed game UID clears the previous board.
- Use `event.key` or `skill.uid` to avoid applying duplicate events.
- Draw every `hitBoxList` entry with both `boxId` and `itemSlotType`.
- Store and display `skill.hitItemTypeNames` when present.

If an event lacks `hitItemTypeNames`, keep the previous type display for the same match unless a new match starts.

## Error Handling

Ethan should show a small monitor status near the switch:

- running
- stopped
- starting/stopping
- error

SSE unsupported or failed status fetch should not break Ethan estimation. The board remains available with an empty state and an error message near the Monitor controls.

Placement warnings should be visible but compact, for example a short list below the type display.

## Testing

Add focused tests around Ethan behavior:

- Renders the 43 x 10 board.
- Starts and stops the monitor through the top bar switch.
- Handles `1002081` SSE event and draws `11`, `21`, and `22` outlines.
- Shows `hitItemTypeNames`.
- Clears previous board state when `gameUid` changes.
- Ignores unrelated skill events.

Existing Monitor tests should not need broad changes because the backend API remains unchanged.

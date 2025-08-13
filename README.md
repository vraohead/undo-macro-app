# Undo Macro (Simple)

**One button, one job**: clears unsent macro text and resets current tags to the ticket’s **last saved** tags (server truth).  
No macro mapping. No audits parsing. No guessing.

## What it does
- Click **Undo** → empties the composer (macro text gone).
- Reads ticket from `/api/v2/tickets/{id}.json` → gets the persisted tag set.
- Overwrites the current working tags with that set → removes tags added by an *unsent* macro and restores tags that macro removed.
- Optional **Reset tags** link does the tag reset *without* clearing comment.
- Shows a **diff preview** of tags removed/restored.

## Why it won't delete old tags
We use the ticket’s last saved tags as the source of truth. Older tags that were already part of the saved ticket remain untouched.

## Install (Private App)
1. Zip the contents of the folder (keep structure intact).
2. Zendesk **Admin Center → Apps and integrations → Zendesk Support apps → Private apps → Upload app**.
3. Install for your test group or all agents.
4. Open a ticket, apply a macro (don’t submit), hit **Undo**.

## Requirements
- ZAF v2.
- Agent permissions to read tickets (API) and edit tags/comment in the UI.

## Notes
- This app **does not** revert other macro effects (status, assignee, form, fields). It only clears the composer and resets tags.
- If you later want full rollback, add an audits-based flow.

## Dev
No build step required. Static assets only.


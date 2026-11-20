# Dataview queries to convert

Put the cursor inside a block and run **Tasklines: Convert Dataview task query under cursor to a base**.

```dataview
TASK
FROM "Projects"
WHERE !completed AND due <= date(today) + dur(7 days)
SORT due ASC, priority DESC
GROUP BY file.link
```

```dataview
TASK
FROM #home OR "Projects/Beta.md"
WHERE contains(text, "fix") AND status = "/"
LIMIT 10
```

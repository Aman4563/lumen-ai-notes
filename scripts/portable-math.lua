-- Convert Pandoc Math nodes to native MathML before writing Markdown.
--
-- Why: ordinary Markdown has no standard LaTeX renderer. MathML is native HTML,
-- renders in modern browser-based previews, and degrades to readable symbols
-- instead of exposing TeX control sequences.

local function trim_paragraph(html)
  html = html:gsub("^%s*<p>", "")
  html = html:gsub("</p>%s*$", "")
  -- The annotation only preserves the original TeX for round-tripping. Removing
  -- it keeps these source notes free from hidden raw LaTeX.
  html = html:gsub("<annotation encoding=\"application/x%-tex\">.-</annotation>", "")
  return html
end

function Math(element)
  local options = pandoc.WriterOptions({html_math_method = "mathml"})
  local rendered = pandoc.write(
    pandoc.Pandoc({pandoc.Para({element})}),
    "html5",
    options
  )
  return pandoc.RawInline("html", trim_paragraph(rendered))
end

#!/usr/bin/env ruby
# frozen_string_literal: true

# Repository-local structural audit for the Markdown curriculum. This validates
# rendering hazards and navigation; it does not replace technical peer review.

root = File.expand_path("..", __dir__)
files = [File.join(root, "README.md")] + Dir.glob(File.join(root, "notes", "**", "*.md"))
errors = []

latex_patterns = {
  "double-dollar math delimiter" => /\$\$/,
  "bracket math delimiter" => /\\\[|\\\]/,
  "parenthesis math delimiter" => /\\\(|\\\)/,
  "raw TeX command" => /\\(?:text|frac|dfrac|tfrac|theta|sigma|mu|mathbb|mathbf|begin|end|left|right|sum|prod|lambda|alpha|beta|gamma|hat|ell|operatorname|partial|nabla|cdot|times|rightarrow|longrightarrow)\b/
}.freeze

paired_tags = %w[details math semantics mrow mfrac msub msup mover].freeze
diagram_start = /^\s*(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram)\b/

files.each do |file|
  relative = file.delete_prefix("#{root}/")
  source = File.read(file)
  lines = source.lines

  first_content = lines.find { |line| !line.strip.empty? }
  errors << "#{relative}: first content is not an H1" unless first_content&.start_with?("# ")

  fence_count = lines.count { |line| line.start_with?("```") }
  errors << "#{relative}: odd number of fenced-block boundaries (#{fence_count})" if fence_count.odd?

  lines.each_with_index do |line, index|
    next unless line.match?(diagram_start)
    previous = index.zero? ? "" : lines[index - 1].strip
    errors << "#{relative}:#{index + 1}: diagram is not inside a Mermaid fence" unless previous == "```mermaid"
  end

  latex_patterns.each do |name, pattern|
    source.to_enum(:scan, pattern).each do
      match = Regexp.last_match
      line = source.byteslice(0, match.begin(0)).count("\n") + 1
      errors << "#{relative}:#{line}: #{name}"
    end
  end

  paired_tags.each do |tag|
    openings = source.scan(/<#{tag}(?:\s|>)/).length
    closings = source.scan(%r{</#{tag}>}).length
    errors << "#{relative}: unbalanced <#{tag}> tags (#{openings}/#{closings})" unless openings == closings
  end

  source.scan(/\]\(([^)]+\.md)(?:#[^)]+)?\)/).flatten.each do |link|
    target = File.expand_path(link, File.dirname(file))
    errors << "#{relative}: missing local link target #{link}" unless File.file?(target)
  end
end

part_indexes = Dir.glob(File.join(root, "notes", "part-*", "README.md"))
errors << "Expected 23 numbered part indexes, found #{part_indexes.length}" unless part_indexes.length == 23

expected_parts = (1..23).map { |number| format("part-%02d-", number) }
actual_directories = part_indexes.map { |path| File.basename(File.dirname(path)) }
expected_parts.each do |prefix|
  errors << "Missing numbered part with prefix #{prefix}" unless actual_directories.any? { |name| name.start_with?(prefix) }
end

curriculum_index_source = File.read(File.join(root, "notes", "README.md"))
part_indexes.each do |index|
  directory = File.dirname(index)
  directory_name = File.basename(directory)
  part_source = Dir.glob(File.join(directory, "*.md")).map { |path| File.read(path) }.join("\n")
  index_source = File.read(index)

  errors << "notes/README.md: missing navigation link for #{directory_name}" unless curriculum_index_source.include?("#{directory_name}/README.md")
  errors << "#{directory_name}: no Mermaid visualization in the Part" unless part_source.include?("```mermaid")

  Dir.glob(File.join(directory, "[0-9][0-9]-*.md")).each do |chapter|
    chapter_name = File.basename(chapter)
    errors << "#{directory_name}/README.md: chapter is not linked: #{chapter_name}" unless index_source.include?(chapter_name)
  end
end

advanced_indexes = part_indexes.select do |path|
  File.basename(File.dirname(path)).match?(/part-(?:1[3-9]|2[0-3])-/)
end
advanced_indexes.each do |index|
  directory = File.dirname(index)
  chapter_count = Dir.glob(File.join(directory, "[0-9][0-9]-*.md")).length
  errors << "#{directory.delete_prefix("#{root}/")}: expected at least 2 topic chapters" if chapter_count < 2

  source = File.read(index)
  errors << "#{index.delete_prefix("#{root}/")}: missing explicit exit gate" unless source.match?(/exit gate/i)
end

legacy_frontier_files = Dir.glob(File.join(root, "notes", "frontier-lab-track", "**", "*"))
errors << "Legacy frontier-lab-track still contains files" unless legacy_frontier_files.empty?

required_general_chapters = [
  "notes/part-03-python-data-stack/06-computer-systems-networking.md",
  "notes/part-03-python-data-stack/07-software-delivery-cloud-security.md",
  "notes/part-13-research-git/01-git-fundamentals.md",
  "notes/part-13-research-git/03-remotes-collaboration-releases.md",
  "notes/part-14-containers-clusters/01-linux-shell-fundamentals.md",
  "notes/part-14-containers-clusters/03-container-docker-fundamentals.md",
  "notes/part-14-containers-clusters/05-docker-networking-storage-compose.md",
  "notes/part-14-containers-clusters/06-kubernetes-fundamentals.md",
  "notes/part-14-containers-clusters/07-slurm-hpc-fundamentals.md",
  "notes/02-general-engineering-coverage-audit.md"
].freeze
required_general_chapters.each do |relative|
  path = File.join(root, relative)
  unless File.file?(path)
    errors << "Missing required general-engineering chapter: #{relative}"
    next
  end

  line_count = File.foreach(path).count
  errors << "General-engineering chapter is too short for substantive coverage: #{relative} (#{line_count} lines)" if line_count < 100
end

minimum_chapter_counts = {
  "part-03-python-data-stack" => 8,
  "part-13-research-git" => 6,
  "part-14-containers-clusters" => 9
}.freeze
minimum_chapter_counts.each do |directory_name, minimum|
  count = Dir.glob(File.join(root, "notes", directory_name, "[0-9][0-9]-*.md")).length
  errors << "#{directory_name}: expected at least #{minimum} substantive chapters, found #{count}" if count < minimum
end

required_terms = [
  "Git", "Docker", "Kubernetes", "Slurm", "CUDA", "Triton", "NCCL", "FSDP",
  "DeepSpeed", "Megatron", "BF16", "FP8", "LoRA", "QLoRA", "SFT", "DPO",
  "PPO", "GRPO", "RLHF", "RLAIF", "reward model", "quantization", "vLLM",
  "TensorRT-LLM", "SGLang", "JAX", "offline RL", "model-based RL", "BuildKit",
  "OCI", "cgroups", "reflog", "bisect", "DQN", "SARSA", "SAC", "TD3",
  "actor–critic", "policy gradient", "off-policy evaluation", "MinHash",
  "tokenization", "decontamination", "FlashAttention", "activation checkpointing",
  "tensor parallel", "pipeline parallel", "context parallel", "expert parallel",
  "continuous batching", "KV cache", "speculative decoding", "OpenTelemetry",
  "Prometheus", "MLflow", "Hydra", "Ray", "Parquet", "safetensors",
  "working tree", "remote-tracking", "force-with-lease", "Docker Compose",
  "named volume", "bind mount", "StatefulSet", "RBAC", "service account",
  "job array", "DNS", "TCP", "TLS", "HTTP", "idempotency", "backpressure",
  "CI/CD", "infrastructure as code", "IAM", "SLO", "threat model", "SBOM"
].freeze

all_source = files.map { |file| File.read(file) }.join("\n")
required_terms.each do |term|
  count = all_source.scan(/(?<![A-Za-z0-9])#{Regexp.escape(term)}(?![A-Za-z0-9])/i).length
  errors << "Required technology/method has no coverage: #{term}" if count.zero?
end

if errors.any?
  warn "Notes audit failed with #{errors.length} issue(s):"
  errors.each { |error| warn "- #{error}" }
  exit 1
end

line_count = files.sum { |file| File.foreach(file).count }
puts "Notes audit passed."
puts "Markdown files: #{files.length}"
puts "Markdown lines: #{line_count}"
puts "Numbered parts: #{part_indexes.length}"

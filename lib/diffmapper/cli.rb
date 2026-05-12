# frozen_string_literal: true

require "English"
module Diffmapper
  class CLI
    extend Dry::Initializer

    param :args, default: -> { [] }
    option :stdin, default: -> {}

    COMMANDS = %w[parse render preview].freeze

    def run
      command = COMMANDS.include?(args.first) ? args.shift : "preview"

      case command
      when "parse" then parse
      when "render" then render
      when "preview" then preview
      end
    end

    private

    def parse
      data = build_parser.call
      puts JSON.pretty_generate(data)
    end

    def render
      json_path = args.shift
      abort "Usage: diffmapper render <file.json>" unless json_path
      abort "File not found: #{json_path}" unless File.exist?(json_path)

      data = JSON.parse(File.read(json_path), symbolize_names: true)
      puts Renderer.new(data).call
    end

    def preview
      data = build_parser.call
      puts Renderer.new(data).call
    end

    def build_parser
      diff_text = read_diff
      parser = Parser.new(diff_text)
      meta_override = detect_meta
      OverridingParser.new(parser, meta_override)
    end

    def read_diff
      if diff_ref
        run_git_diff(diff_ref)
      elsif stdin
        stdin
      elsif !$stdin.tty?
        $stdin.read
      else
        abort usage_message
      end
    end

    def diff_ref
      # First non-flag argument is the diff ref (e.g., "master...feature")
      args.find { |a| !a.start_with?("-") }
    end

    def run_git_diff(ref)
      output = `git diff --no-ext-diff #{ref} 2>&1`
      abort "git diff failed: #{output}" unless $CHILD_STATUS.success?

      output
    end

    def detect_meta
      ref = diff_ref
      return {} unless ref

      parts = ref.split("...")
      {
        base: parts[0],
        branch: parts[1],
        title: humanize_branch(parts[1] || parts[0])
      }.compact
    end

    def humanize_branch(branch)
      branch
        .sub(%r{^origin/}, "")
        .gsub(/\b[A-Za-z]+-\d+[-_]?/, "") # strip ticket prefixes like PLS-1519
        .gsub(%r{[_/-]}, " ")
        .strip
        .capitalize
    end

    def usage_message
      <<~MSG
        Usage:
          diffmapper master...feature               Generate HTML canvas (default)
          diffmapper parse master...feature           Parse diff to JSON
          diffmapper render enriched.json             Render JSON to HTML

          git diff --no-ext-diff | diffmapper         Pipe diff in
      MSG
    end

    def usage
      warn usage_message
      exit 1
    end
  end

  # Wraps Parser to inject meta overrides
  class OverridingParser
    extend Dry::Initializer

    param :parser
    param :overrides, default: -> { {} }

    def call
      result = parser.call
      result[:meta].merge!(overrides)
      result
    end
  end
end

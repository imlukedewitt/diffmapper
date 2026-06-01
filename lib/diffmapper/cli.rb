# frozen_string_literal: true

require "English"
module Diffmapper
  class CLI
    extend Dry::Initializer

    param :args, default: -> { [] }
    option :stdin, default: -> {}

    COMMANDS = %w[parse render preview enrich setup].freeze

    def run
      command = COMMANDS.include?(args.first) ? args.shift : "preview"

      case command
      when "parse" then parse
      when "render" then render
      when "preview" then preview
      when "enrich" then enrich
      when "setup" then setup
      end
    end

    private

    def setup = SetupCommand.new(args).run

    def parse
      data = build_parser.call

      if stdout_mode?
        puts JSON.pretty_generate(data)
      else
        path = workspace.data_path(detect_branch)
        File.write(path, JSON.pretty_generate(data))
        puts path
      end
    end

    def render
      arg = args.shift
      abort "Usage: diffmapper render <file.json|branch>" unless arg

      json_path = File.exist?(arg) ? arg : workspace.resolve_data_path(arg)
      abort "File not found: #{arg}" unless json_path

      data = JSON.parse(File.read(json_path), symbolize_names: true)
      html = Renderer.new(data).call
      output_html(html, data, json_path)
    end

    def preview = puts(Renderer.new(build_parser.call).call)

    def enrich = EnrichCommand.new(args).run

    def workspace
      @workspace ||= Workspace.new
    end

    def stdout_mode?
      args.delete("--stdout")
    end

    def detect_branch
      ref = diff_ref
      return "output" unless ref

      ref.split("...").last
    end

    def resolve_html_path(data, json_path)
      branch = data.dig(:meta, :branch) || File.basename(json_path, ".json")
      workspace.html_path(branch)
    end

    def output_html(html, data, json_path)
      if stdout_mode?
        puts html
      else
        path = resolve_html_path(data, json_path)
        File.write(path, html)
        puts path
      end
    end

    def build_parser
      diff_text = read_diff
      OverridingParser.new(Parser.new(diff_text), detect_meta)
    end

    def read_diff
      return run_git_diff(diff_ref) if diff_ref
      return stdin if stdin
      return $stdin.read unless $stdin.tty?

      abort usage_message
    end

    def diff_ref
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

      base, branch = ref.split("...")
      { base: base, branch: branch, title: humanize_branch(branch || base) }.compact
    end

    def humanize_branch(name)
      name.sub(%r{^origin/}, "").gsub(/\b[A-Za-z]+-\d+[-_]?/, "").gsub(%r{[_/-]}, " ").strip.capitalize
    end

    def usage_message
      <<~MSG
        Usage: diffmapper [parse|render|enrich|setup] [options]
          diffmapper parse master...feature
          diffmapper render data.json
          diffmapper enrich data.json file <id> --summary "..."
          diffmapper setup [skills-directory]
          git diff --no-ext-diff | diffmapper
      MSG
    end
  end
end

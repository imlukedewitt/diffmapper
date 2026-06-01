# frozen_string_literal: true

require "fileutils"

module Diffmapper
  class SetupCommand
    SKILL_OPTIONS = [
      { label: "Claude Code (~/.claude/skills)", path: "~/.claude/skills" },
      { label: "Pi (~/.pi/agent/skills)", path: "~/.pi/agent/skills" }
    ].freeze

    SKILL_SOURCE = File.expand_path("skill/SKILL.md", __dir__)
    SKILL_DIR_NAME = "diffmapper-review"

    def initialize(args)
      @target = args.first
    end

    def run
      dir = @target ? File.expand_path(@target) : prompt_for_directory
      install_skill(dir) if dir
    end

    private

    def prompt_for_directory
      print_options
      parse_choice($stdin.gets&.strip)
    end

    def print_options
      puts "Install diffmapper agent skill to:"
      puts
      SKILL_OPTIONS.each_with_index { |opt, i| puts "  #{i + 1}. #{opt[:label]}" }
      puts "  #{SKILL_OPTIONS.length + 1}. Custom path"
      puts
      print "> "
    end

    def parse_choice(choice)
      return unless choice

      index = choice.to_i - 1
      return File.expand_path(SKILL_OPTIONS[index][:path]) if index >= 0 && index < SKILL_OPTIONS.length

      prompt_custom_path if index == SKILL_OPTIONS.length
    end

    def prompt_custom_path
      print "Path: "
      path = $stdin.gets&.strip
      File.expand_path(path) if path && !path.empty?
    end

    def install_skill(dir)
      dest_dir = File.join(dir, SKILL_DIR_NAME)
      FileUtils.mkdir_p(dest_dir)
      FileUtils.cp(SKILL_SOURCE, File.join(dest_dir, "SKILL.md"))
      puts "Installed skill to #{dest_dir}/SKILL.md"
    end
  end
end

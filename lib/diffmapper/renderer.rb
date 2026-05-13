# frozen_string_literal: true

require "erb"
require "json"

module Diffmapper
  class Renderer
    extend Dry::Initializer

    param :data

    TEMPLATE_PATH = File.join(__dir__, "templates", "canvas.html.erb")

    def call
      template = File.read(TEMPLATE_PATH)
      ERB.new(template, trim_mode: "-").result(binding)
    end

    private

    def meta = data[:meta]
    def context = data[:context]
    def files = data[:files]
    def connections = data[:connections] || []

    def title
      context&.dig(:summary) || meta&.dig(:title) || "Diff Review"
    end

    def stats = meta&.dig(:stats) || {}

    def grouped_files
      specs, sources = files.partition { |f| f[:type] == "spec" }
      paired, matched_ids = build_pairs(specs, sources)
      unpaired_sources = sources.reject { |f| matched_ids[:sources].include?(f[:id]) }
      unpaired_specs = specs.reject { |f| matched_ids[:specs].include?(f[:id]) }

      { paired: paired, unpaired_sources: unpaired_sources, unpaired_specs: unpaired_specs }
    end

    def grouped_files_json
      groups = grouped_files
      {
        paired: groups[:paired].map { |s, t| [file_layout_data(s), file_layout_data(t)] },
        unpaired_sources: groups[:unpaired_sources].map { |f| file_layout_data(f) },
        unpaired_specs: groups[:unpaired_specs].map { |f| file_layout_data(f) }
      }.to_json
    end

    def file_layout_data(file)
      { id: file[:id], type: file[:type], dir: file_directory(file[:path]), path: file[:path], status: file[:status] }
    end

    def file_directory(path)
      # Extract meaningful directory grouping
      # e.g., "app/controllers/team_projects/archive_controller.rb" → "controllers/team_projects"
      # e.g., "frontend/js/ProjectArchive/ArchiveOptions.js" → "frontend/js/ProjectArchive"
      dir = File.dirname(path)
      dir.sub(%r{^(app|spec|test)/}, "")
    end

    def build_pairs(specs, sources)
      matched_ids = { specs: [], sources: [] }
      test_conns = connections.select { |c| c[:type] == "test" }
      paired = test_conns.filter_map { |conn| match_pair(conn, specs, sources, matched_ids) }
      [paired, matched_ids]
    end

    def match_pair(conn, specs, sources, matched_ids)
      source = sources.find { |f| f[:id] == conn[:to] }
      spec = specs.find { |f| f[:id] == conn[:from] }
      return unless source && spec

      matched_ids[:sources] << source[:id]
      matched_ids[:specs] << spec[:id]
      [source, spec]
    end

    def card_height(_file)
      # Rough estimate for canvas min-height sizing; JS handles actual layout
      120
    end

    def canvas_min_height
      (files.length * card_height(nil)) + 200
    end

    def status_class(file)
      file[:status]
    end

    def badge_class(file)
      "badge-#{file[:type]}"
    end

    def connections_json
      connections.to_json
    end

    def format_hunks(hunks)
      hunks.each_line.map { |line| format_diff_line(line) }.join
    end

    def format_diff_line(line)
      escaped = ERB::Util.html_escape(line.chomp)
      css_class = diff_line_class(line)
      "<span class=\"#{css_class}\">#{escaped}</span>\n"
    end

    def diff_line_class(line)
      case line
      when /^@@/ then "diff-line-hunk"
      when /^\+/ then "diff-line-add"
      when /^-/  then "diff-line-del"
      else "diff-line-ctx"
      end
    end
  end
end

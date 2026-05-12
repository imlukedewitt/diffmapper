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

    def layout
      @layout ||= compute_layout
    end

    def compute_layout
      paired, unpaired_specs, unpaired_sources = group_files
      positions = {}
      y = 80

      y = layout_paired(paired, positions, y)
      y = layout_column(unpaired_sources, positions, y, col: 60)
      layout_column(unpaired_specs, positions, y, col: 520)

      positions
    end

    def layout_paired(paired, positions, top)
      paired.each do |source, spec|
        positions[source[:id]] = { x: 60, y: top }
        positions[spec[:id]] = { x: 520, y: top }
        top += [card_height(source), card_height(spec)].max + 30
      end
      top
    end

    def layout_column(file_list, positions, top, col:)
      file_list.each do |file|
        positions[file[:id]] = { x: col, y: top }
        top += card_height(file) + 30
      end
      top
    end

    def group_files
      specs, sources = files.partition { |f| f[:type] == "spec" }
      paired, matched_ids = build_pairs(specs, sources)
      unpaired_sources = sources.reject { |f| matched_ids[:sources].include?(f[:id]) }
      unpaired_specs = specs.reject { |f| matched_ids[:specs].include?(f[:id]) }

      [paired, unpaired_specs, unpaired_sources]
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

    def card_height(file)
      base = 90
      base += 20 if file[:summary]
      base += (file[:details]&.length || 0) * 24
      base
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
  end
end

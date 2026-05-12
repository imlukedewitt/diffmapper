# frozen_string_literal: true

require_relative "diff_parser"
require_relative "connection_detector"

module Diffmapper
  class Parser
    extend Dry::Initializer

    param :diff_text

    def call
      parsed = DiffParser.new(diff_text).parse
      connections = ConnectionDetector.new(parsed[:files]).detect

      {
        meta: build_meta(parsed),
        context: { summary: nil, description: nil },
        files: parsed[:files],
        connections: connections
      }
    end

    private

    def build_meta(parsed)
      parsed[:meta].merge(
        title: nil,
        branch: nil,
        base: nil,
        generated_at: Time.now.iso8601
      )
    end
  end
end

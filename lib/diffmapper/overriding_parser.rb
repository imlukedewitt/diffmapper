# frozen_string_literal: true

module Diffmapper
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

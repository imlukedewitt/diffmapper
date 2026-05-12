# frozen_string_literal: true

module Diffmapper
  class FileClassifier
    PATTERNS = [
      { pattern: %r{^spec/|^test/|\.test\.|_test\.|_spec\.}, type: "spec" },
      { pattern: %r{^app/models/}, type: "model" },
      { pattern: %r{^app/controllers/}, type: "controller" },
      { pattern: %r{^app/serializers/}, type: "serializer" },
      { pattern: %r{^app/services/}, type: "service" },
      { pattern: %r{^app/jobs/|^app/workers/}, type: "job" },
      { pattern: %r{^app/views/|^app/components/|\.jsx$|\.tsx$|\.vue$}, type: "component" },
      { pattern: %r{^config/}, type: "config" },
      { pattern: /\.css$|\.scss$|\.styles\.|\.styled\./, type: "styles" },
      { pattern: %r{^db/migrate/}, type: "migration" }
    ].freeze

    def self.classify(path)
      PATTERNS.each do |entry|
        return entry[:type] if path.match?(entry[:pattern])
      end

      "other"
    end
  end
end

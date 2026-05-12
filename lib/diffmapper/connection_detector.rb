# frozen_string_literal: true

module Diffmapper
  class ConnectionDetector
    extend Dry::Initializer

    param :files

    def detect
      specs, sources = files.partition { |f| f[:type] == "spec" }
      specs.filter_map { |spec| match_spec_to_source(spec, sources) }
    end

    private

    def match_spec_to_source(spec, sources)
      source = find_source(spec, sources)
      return unless source

      {
        from: spec[:id],
        to: source[:id],
        label: "tests",
        type: "test"
      }
    end

    def find_source(spec, sources)
      source_path = spec_to_source_path(spec[:path])
      sources.find { |s| s[:path] == source_path } ||
        sources.find { |s| s[:path] == collapse_nested_spec_path(spec[:path]) }
    end

    def spec_to_source_path(path)
      path
        .sub(%r{^spec/}, "app/")
        .sub(/_spec\.rb$/, ".rb")
        .sub(/\.test\.(jsx?|tsx?)$/, '.\1')
    end

    def collapse_nested_spec_path(path)
      # spec/services/tasks/archiver/archiver_spec.rb → app/services/tasks/archiver.rb
      source = spec_to_source_path(path)
      dir = File.dirname(source)
      base = File.basename(source, File.extname(source))
      parent_dir = File.dirname(dir)
      dir_name = File.basename(dir)

      return source unless dir_name == base

      File.join(parent_dir, "#{base}.rb")
    end
  end
end

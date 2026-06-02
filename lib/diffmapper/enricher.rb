# frozen_string_literal: true

require "json"

module Diffmapper
  class Enricher
    extend Dry::Initializer

    param :path

    def enrich_context(summary: nil, description: nil)
      mutate do |data|
        data[:context] ||= {}
        data[:context][:summary] = summary if summary
        data[:context][:description] = description if description
      end
    end

    def enrich_file(file_id, summary: nil, detail: nil, annotation: nil, type: nil)
      mutate do |data|
        file = find_file(data, file_id)
        file[:summary] = summary if summary
        file[:type] = type if type
        append_detail(file, detail) if detail
        append_annotation(file, annotation) if annotation
      end
    end

    def add_connection(from_id, to_id, label: nil, type: nil)
      mutate do |data|
        data[:connections] ||= []
        next if connection_exists?(data[:connections], from_id, to_id, type)

        data[:connections] << build_connection(from_id, to_id, label, type)
      end
    end

    private

    def connection_exists?(connections, from_id, to_id, type)
      connections.any? { |c| c[:from] == from_id && c[:to] == to_id && c[:type] == type }
    end

    def build_connection(from_id, to_id, label, type)
      conn = { from: from_id, to: to_id }
      conn[:label] = label if label
      conn[:type] = type if type
      conn
    end

    def mutate
      File.open(path, File::RDWR | File::CREAT) do |f|
        f.flock(File::LOCK_EX)
        data = JSON.parse(f.read, symbolize_names: true)
        yield data
        f.rewind
        f.truncate(0)
        f.write(JSON.pretty_generate(data))
      end
    end

    def find_file(data, file_id)
      file = data[:files]&.find { |f| f[:id] == file_id }
      raise ArgumentError, "File not found: #{file_id}" unless file

      file
    end

    def append_detail(file, detail)
      file[:details] ||= []
      return if file[:details].any? { |d| d[:label] == detail[0] }

      file[:details] << { label: detail[0], description: detail[1] }
    end

    def append_annotation(file, annotation)
      file[:annotations] ||= []
      file[:annotations] << { type: annotation[0], text: annotation[1] }
    end
  end
end

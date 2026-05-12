# frozen_string_literal: true

require_relative "file_classifier"

module Diffmapper
  class DiffParser
    extend Dry::Initializer

    param :diff_text

    def parse
      files = parse_files
      {
        meta: {
          stats: {
            files: files.length,
            additions: files.sum { |f| f[:additions] },
            deletions: files.sum { |f| f[:deletions] }
          }
        },
        files: files
      }
    end

    private

    def parse_files
      split_file_diffs.map { |chunk| parse_file(chunk) }
    end

    def split_file_diffs
      diff_text.split(/^diff --git /).drop(1)
    end

    def parse_file(chunk)
      path = extract_path(chunk)
      additions, deletions = count_lines(chunk)

      {
        id: id_from_path(path),
        path: path,
        status: detect_status(chunk),
        type: FileClassifier.classify(path),
        additions: additions,
        deletions: deletions,
        hunks: extract_hunks(chunk)
      }
    end

    def extract_path(chunk)
      header = chunk.split(/^@@/).first || chunk

      match = header.match(/^rename to (.+)$/) ||
              header.match(%r{^\+\+\+ b/(.+)$})&.then { |m| m unless m[1].include?(File::NULL) } ||
              header.match(%r{^--- a/(.+)$})

      match ? match[1].strip : "unknown"
    end

    def detect_status(chunk)
      case chunk
      when /^new file mode/
        "new"
      when /^deleted file mode/
        "deleted"
      when /^rename from/
        "renamed"
      else
        "modified"
      end
    end

    def count_lines(chunk)
      additions = 0
      deletions = 0
      in_hunk = false

      chunk.each_line do |line|
        if line.start_with?("@@")
          in_hunk = true
          next
        end
        next unless in_hunk

        additions += 1 if line.start_with?("+")
        deletions += 1 if line.start_with?("-")
      end

      [additions, deletions]
    end

    def extract_hunks(chunk)
      idx = chunk.index(/^@@/)
      return nil unless idx

      chunk[idx..]
    end

    def id_from_path(path)
      File.basename(path, File.extname(path))
          .downcase
          .gsub(/[^a-z0-9]/, "_")
    end
  end
end

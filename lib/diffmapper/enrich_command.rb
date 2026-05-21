# frozen_string_literal: true

module Diffmapper
  class EnrichCommand
    extend Dry::Initializer

    param :args

    def run
      json_path = args.shift
      abort "Usage: diffmapper enrich <file.json> <target> [options]" unless json_path
      abort "File not found: #{json_path}" unless File.exist?(json_path)

      target = args.shift
      enricher = Enricher.new(json_path)

      case target
      when "context" then enrich_context(enricher)
      when "file" then enrich_file(enricher)
      when "connection" then enrich_connection(enricher)
      else abort "Unknown enrich target: #{target}. Use: context, file, connection"
      end
    end

    private

    def enrich_context(enricher)
      opts = parse_flags("--summary", "--description")
      enricher.enrich_context(summary: opts["--summary"], description: opts["--description"])
    end

    def enrich_file(enricher)
      file_id = args.shift
      abort "Usage: diffmapper enrich <file.json> file <id> [options]" unless file_id

      opts = parse_flags("--summary", "--type")
      detail = parse_pair("--detail")
      annotation = parse_pair("--annotation")

      enricher.enrich_file(
        file_id,
        summary: opts["--summary"],
        type: opts["--type"],
        detail: detail,
        annotation: annotation
      )
    end

    def enrich_connection(enricher)
      from_id = args.shift
      to_id = args.shift
      abort "Usage: diffmapper enrich <file.json> connection <from> <to> [options]" unless from_id && to_id

      opts = parse_flags("--label", "--type")
      enricher.add_connection(from_id, to_id, label: opts["--label"], type: opts["--type"])
    end

    def parse_flags(*flag_names)
      result = {}
      flag_names.each do |flag|
        idx = args.index(flag)
        next unless idx

        args.delete_at(idx)
        result[flag] = args.delete_at(idx)
      end
      result
    end

    def parse_pair(flag)
      idx = args.index(flag)
      return nil unless idx

      args.delete_at(idx)
      [args.delete_at(idx), args.delete_at(idx)]
    end
  end
end

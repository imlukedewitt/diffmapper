# frozen_string_literal: true

require "yaml"
require "fileutils"

module Diffmapper
  class Workspace
    CONFIG_FILE = ".diffmapper.yml"
    DEFAULT_DIR = "_diffmapper"
    DATA_SUBDIR = "data"

    extend Dry::Initializer

    param :cwd, default: -> { Dir.pwd }

    def data_path(branch)
      path = File.join(data_dir, "#{slugify(branch)}.json")
      FileUtils.mkdir_p(File.dirname(path))
      path
    end

    def html_path(branch)
      path = File.join(output_dir, "#{slugify(branch)}.html")
      FileUtils.mkdir_p(File.dirname(path))
      path
    end

    def output_dir
      config["output_dir"] || File.join(cwd, DEFAULT_DIR)
    end

    private

    def data_dir
      File.join(cwd, DEFAULT_DIR, DATA_SUBDIR)
    end

    def config
      @config ||= load_config
    end

    def load_config
      path = File.join(cwd, CONFIG_FILE)
      return {} unless File.exist?(path)

      YAML.safe_load_file(path) || {}
    end

    def slugify(branch)
      branch
        .sub(%r{^origin/}, "")
        .gsub(/[^a-zA-Z0-9._-]/, "-")
        .gsub(/-+/, "-")
        .sub(/^-/, "")
        .sub(/-$/, "")
    end
  end
end

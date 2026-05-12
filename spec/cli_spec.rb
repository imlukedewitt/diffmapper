# frozen_string_literal: true

require "diffmapper"
require "diffmapper/parser"
require "diffmapper/renderer"
require "diffmapper/cli"
require "json"
require "securerandom"
require "tmpdir"

RSpec.describe Diffmapper::CLI do
  let(:fixture_path) { File.join(__dir__, "fixtures/diffs/real_pr.diff") }
  let(:diff_text) { File.read(fixture_path) }

  describe "parse command" do
    it "outputs valid JSON to stdout" do
      output = capture_stdout { described_class.new(["parse"], stdin: diff_text).run }
      data = JSON.parse(output)
      expect(data["files"].length).to eq(13)
    end

    it "includes meta stats" do
      output = capture_stdout { described_class.new(["parse"], stdin: diff_text).run }
      data = JSON.parse(output)
      expect(data["meta"]["stats"]["additions"]).to eq(149)
    end
  end

  describe "render command" do
    it "outputs HTML from a JSON file" do
      json_path = write_temp_json
      output = capture_stdout { described_class.new(["render", json_path]).run }
      expect(output).to include("<!DOCTYPE html>")
    end

    it "aborts when file not found" do
      expect do
        suppress_stderr { described_class.new(["render", "/nonexistent.json"]).run }
      end.to raise_error(SystemExit)
    end

    it "aborts when no file given" do
      expect do
        suppress_stderr { described_class.new(["render"]).run }
      end.to raise_error(SystemExit)
    end
  end

  describe "preview command (default)" do
    it "outputs HTML" do
      output = capture_stdout { described_class.new([], stdin: diff_text).run }
      expect(output).to include("<!DOCTYPE html>")
    end

    it "is the default when no command given" do
      output = capture_stdout { described_class.new([], stdin: diff_text).run }
      expect(output).to include("<div class=\"card")
    end
  end

  describe "detect_meta" do
    it "extracts branch and base from ref" do
      cli = described_class.new(["master...feature-branch"])
      meta = cli.send(:detect_meta)
      expect(meta[:base]).to eq("master")
      expect(meta[:branch]).to eq("feature-branch")
    end

    it "humanizes branch name into title" do
      cli = described_class.new(["master...PLS-1519-add-cool-feature"])
      meta = cli.send(:detect_meta)
      expect(meta[:title]).to eq("Add cool feature")
    end

    it "strips origin prefix" do
      cli = described_class.new(["master...origin/PLS-123-fix-bug"])
      meta = cli.send(:detect_meta)
      expect(meta[:title]).to eq("Fix bug")
    end

    it "returns empty hash when no ref" do
      cli = described_class.new([])
      meta = cli.send(:detect_meta)
      expect(meta).to eq({})
    end
  end

  private

  def suppress_stderr
    old_stderr = $stderr
    $stderr = StringIO.new
    yield
  ensure
    $stderr = old_stderr
  end

  def capture_stdout
    old_stdout = $stdout
    $stdout = StringIO.new
    # Provide stdin if needed
    yield
    $stdout.string
  ensure
    $stdout = old_stdout
  end

  def write_temp_json
    data = Diffmapper::Parser.new(diff_text).call
    path = File.join(Dir.tmpdir, "diffmapper_cli_test_#{SecureRandom.hex(4)}.json")
    File.write(path, JSON.generate(data))
    path
  end
end

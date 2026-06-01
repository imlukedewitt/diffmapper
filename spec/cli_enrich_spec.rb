# frozen_string_literal: true

require "spec_helper"
require "json"
require "tempfile"

require_relative "../lib/diffmapper"
require_relative "../lib/diffmapper/enricher"
require_relative "../lib/diffmapper/enrich_command"

RSpec.describe Diffmapper::EnrichCommand do
  let(:base_data) do
    {
      meta: { stats: { files: 1 } },
      context: {},
      files: [
        { id: "widget", path: "app/models/widget.rb", type: "model", additions: 3, deletions: 0, details: [],
          hunks: "" }
      ],
      connections: []
    }
  end

  let(:tmpfile) do
    f = Tempfile.new(["cli_enrich", ".json"])
    f.write(JSON.pretty_generate(base_data))
    f.close
    f
  end

  after { tmpfile.unlink }

  def run_enrich(*args)
    system("ruby", "bin/diffmapper", "enrich", tmpfile.path, *args, exception: true)
  end

  def read_data
    JSON.parse(File.read(tmpfile.path), symbolize_names: true)
  end

  it "enriches context summary" do
    run_enrich("context", "--summary", "Add widget support")
    expect(read_data[:context][:summary]).to eq("Add widget support")
  end

  it "enriches file summary" do
    run_enrich("file", "widget", "--summary", "Core widget model")
    expect(read_data[:files][0][:summary]).to eq("Core widget model")
  end

  it "adds a detail to a file" do
    run_enrich("file", "widget", "--detail", "initialize", "Sets defaults")
    details = read_data[:files][0][:details]
    expect(details.last).to eq(label: "initialize", description: "Sets defaults")
  end

  it "adds an annotation to a file" do
    run_enrich("file", "widget", "--annotation", "question", "Why mutable?")
    annotations = read_data[:files][0][:annotations]
    expect(annotations).to eq([{ type: "question", text: "Why mutable?" }])
  end

  it "changes a file type" do
    run_enrich("file", "widget", "--type", "service")
    expect(read_data[:files][0][:type]).to eq("service")
  end

  it "adds a connection" do
    run_enrich("connection", "widget", "other", "--label", "calls", "--type", "calls")
    conns = read_data[:connections]
    expect(conns.last).to eq(from: "widget", to: "other", label: "calls", type: "calls")
  end

  it "combines multiple flags in one call" do
    run_enrich("file", "widget", "--summary", "Widget model", "--type", "service")
    file = read_data[:files][0]
    expect(file[:summary]).to eq("Widget model")
    expect(file[:type]).to eq("service")
  end

  it "resolves branch name to workspace data path" do
    Dir.mktmpdir do |dir|
      Dir.chdir(dir) do
        data_dir = File.join(dir, "_diffmapper", "data")
        FileUtils.mkdir_p(data_dir)
        json_path = File.join(data_dir, "my-feature.json")
        File.write(json_path, JSON.pretty_generate(base_data))

        bin = File.expand_path("../bin/diffmapper", __dir__)
        output = `ruby #{bin} enrich my-feature file widget --summary "From branch name" 2>&1`
        expect($?.exitstatus).to eq(0), "CLI failed: #{output}"

        result = JSON.parse(File.read(json_path), symbolize_names: true)
        expect(result[:files][0][:summary]).to eq("From branch name")
      end
    end
  end
end

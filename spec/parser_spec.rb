# frozen_string_literal: true

require "diffmapper"
require "diffmapper/parser"

RSpec.describe Diffmapper::Parser do
  subject(:result) { described_class.new(diff_text).call }

  let(:diff_text) { File.read(File.join(__dir__, "fixtures/diffs/real_pr.diff")) }

  it "includes meta with stats" do
    expect(result[:meta][:stats]).to eq(files: 13, additions: 149, deletions: 10)
  end

  it "includes generated_at timestamp" do
    expect(result[:meta][:generated_at]).to match(/^\d{4}-\d{2}-\d{2}T/)
  end

  it "includes empty context for LLM enrichment" do
    expect(result[:context]).to eq(summary: nil, description: nil)
  end

  it "includes all files with types" do
    types = result[:files].map { |f| f[:type] }
    expect(types).to include("controller", "service", "component", "spec")
  end

  it "detects spec-to-source connections" do
    test_connections = result[:connections].select { |c| c[:type] == "test" }
    expect(test_connections.length).to eq(4)
  end

  it "produces valid connection references" do
    file_ids = result[:files].map { |f| f[:id] }
    result[:connections].each do |conn|
      expect(file_ids).to include(conn[:from]), "#{conn[:from]} not in file ids"
      expect(file_ids).to include(conn[:to]), "#{conn[:to]} not in file ids"
    end
  end
end

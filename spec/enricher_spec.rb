# frozen_string_literal: true

require "spec_helper"
require "json"
require "tempfile"
require_relative "../lib/diffmapper"
require_relative "../lib/diffmapper/enricher"

RSpec.describe Diffmapper::Enricher do
  let(:base_data) do
    {
      meta: { stats: { files: 2, additions: 10, deletions: 3 } },
      context: {},
      files: [
        { id: "foo", path: "app/models/foo.rb", type: "model", additions: 5, deletions: 1, details: [], hunks: "" },
        { id: "bar", path: "app/services/bar.rb", type: "service", additions: 5, deletions: 2, details: [], hunks: "" }
      ],
      connections: [
        { from: "foo_spec", to: "foo", label: "tests", type: "test" }
      ]
    }
  end

  let(:tmpfile) do
    f = Tempfile.new(["enricher_test", ".json"])
    f.write(JSON.pretty_generate(base_data))
    f.close
    f
  end

  let(:enricher) { described_class.new(tmpfile.path) }

  def read_data
    JSON.parse(File.read(tmpfile.path), symbolize_names: true)
  end

  after { tmpfile.unlink }

  describe "#enrich_context" do
    it "sets the summary" do
      enricher.enrich_context(summary: "A great PR")
      expect(read_data[:context][:summary]).to eq("A great PR")
    end

    it "sets the description" do
      enricher.enrich_context(description: "Longer explanation here")
      expect(read_data[:context][:description]).to eq("Longer explanation here")
    end

    it "preserves existing fields when setting one" do
      enricher.enrich_context(summary: "First")
      enricher.enrich_context(description: "Second")
      data = read_data
      expect(data[:context][:summary]).to eq("First")
      expect(data[:context][:description]).to eq("Second")
    end
  end

  describe "#enrich_file" do
    it "sets a file summary" do
      enricher.enrich_file("foo", summary: "Handle foo logic")
      expect(read_data[:files][0][:summary]).to eq("Handle foo logic")
    end

    it "sets a file type" do
      enricher.enrich_file("bar", type: "controller")
      expect(read_data[:files][1][:type]).to eq("controller")
    end

    it "appends a detail" do
      enricher.enrich_file("foo", detail: ["initialize", "Sets up dependencies"])
      details = read_data[:files][0][:details]
      expect(details.last).to eq(label: "initialize", description: "Sets up dependencies")
    end

    it "does not duplicate details with the same label" do
      enricher.enrich_file("foo", detail: %w[initialize First])
      enricher.enrich_file("foo", detail: %w[initialize Second])
      details = read_data[:files][0][:details]
      expect(details.count { |d| d[:label] == "initialize" }).to eq(1)
    end

    it "appends an annotation" do
      enricher.enrich_file("foo", annotation: ["question", "Is this safe?"])
      annotations = read_data[:files][0][:annotations]
      expect(annotations).to eq([{ type: "question", text: "Is this safe?" }])
    end

    it "raises for unknown file ID" do
      expect { enricher.enrich_file("nonexistent", summary: "x") }
        .to raise_error(ArgumentError, /not found: nonexistent/)
    end
  end

  describe "file locking" do
    def hold_lock_and_enrich
      done = false
      t = Thread.new do
        enricher.enrich_context(summary: "after lock released")
        done = true
      end
      sleep 0.15
      [t, -> { done }]
    end

    it "blocks while another process holds the lock" do
      File.open(tmpfile.path, File::RDWR) do |lock_file|
        lock_file.flock(File::LOCK_EX)
        t, done_check = hold_lock_and_enrich
        expect(done_check.call).to be false
        lock_file.flock(File::LOCK_UN)
        t.join
        expect(done_check.call).to be true
      end
      expect(read_data[:context][:summary]).to eq("after lock released")
    end
  end

  describe "#add_connection" do
    it "adds a new connection" do
      enricher.add_connection("foo", "bar", label: "calls", type: "calls")
      conns = read_data[:connections]
      expect(conns.last).to eq(from: "foo", to: "bar", label: "calls", type: "calls")
    end

    it "does not duplicate an existing connection" do
      enricher.add_connection("foo", "bar", label: "calls", type: "calls")
      enricher.add_connection("foo", "bar", label: "calls", type: "calls")
      conns = read_data[:connections].select { |c| c[:type] == "calls" }
      expect(conns.length).to eq(1)
    end

    it "preserves existing connections" do
      enricher.add_connection("foo", "bar", label: "calls", type: "calls")
      conns = read_data[:connections]
      expect(conns.first).to eq(from: "foo_spec", to: "foo", label: "tests", type: "test")
    end
  end
end

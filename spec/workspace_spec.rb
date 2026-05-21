# frozen_string_literal: true

require "spec_helper"
require "tmpdir"
require "yaml"
require_relative "../lib/diffmapper"
require_relative "../lib/diffmapper/workspace"

RSpec.describe Diffmapper::Workspace do
  let(:tmpdir) { Dir.mktmpdir }
  let(:workspace) { described_class.new(tmpdir) }

  after { FileUtils.rm_rf(tmpdir) }

  describe "#data_path" do
    it "returns a path in _diffmapper/data/" do
      path = workspace.data_path("feature-branch")
      expect(path).to eq(File.join(tmpdir, "_diffmapper/data/feature-branch.json"))
    end

    it "creates the directory" do
      path = workspace.data_path("feature-branch")
      expect(File.directory?(File.dirname(path))).to be true
    end

    it "slugifies branch names" do
      path = workspace.data_path("origin/PLS-123/cool feature")
      expect(File.basename(path)).to eq("PLS-123-cool-feature.json")
    end
  end

  describe "#html_path" do
    it "returns a path in _diffmapper/" do
      path = workspace.html_path("feature-branch")
      expect(path).to eq(File.join(tmpdir, "_diffmapper/feature-branch.html"))
    end

    it "creates the directory" do
      path = workspace.html_path("my-branch")
      expect(File.directory?(File.dirname(path))).to be true
    end
  end

  describe "#output_dir" do
    it "defaults to _diffmapper in cwd" do
      expect(workspace.output_dir).to eq(File.join(tmpdir, "_diffmapper"))
    end

    it "reads output_dir from .diffmapper.yml" do
      File.write(File.join(tmpdir, ".diffmapper.yml"), YAML.dump("output_dir" => "/custom/path"))
      ws = described_class.new(tmpdir)
      expect(ws.output_dir).to eq("/custom/path")
    end
  end

  describe "slugify" do
    it "strips origin/ prefix" do
      path = workspace.data_path("origin/my-branch")
      expect(File.basename(path, ".json")).to eq("my-branch")
    end

    it "replaces special characters with dashes" do
      path = workspace.data_path("feature/add cool thing")
      expect(File.basename(path, ".json")).to eq("feature-add-cool-thing")
    end

    it "collapses multiple dashes" do
      path = workspace.data_path("a///b")
      expect(File.basename(path, ".json")).to eq("a-b")
    end
  end
end

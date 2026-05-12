# frozen_string_literal: true

require "diffmapper"
require "diffmapper/connection_detector"

RSpec.describe Diffmapper::ConnectionDetector do
  subject(:connections) { described_class.new(files).detect }

  context "with a Rails spec matching its source" do
    let(:files) do
      [
        { id: "user", path: "app/models/user.rb", type: "model" },
        { id: "user_spec", path: "spec/models/user_spec.rb", type: "spec" }
      ]
    end

    it "detects the test connection" do
      expect(connections).to eq([
                                  { from: "user_spec", to: "user", label: "tests", type: "test" }
                                ])
    end
  end

  context "with nested controller paths" do
    let(:files) do
      [
        { id: "archive_controller", path: "app/controllers/team_projects/archive_controller.rb", type: "controller" },
        { id: "archive_controller_spec", path: "spec/controllers/team_projects/archive_controller_spec.rb",
          type: "spec" }
      ]
    end

    it "matches through nested directories" do
      expect(connections).to eq([
                                  { from: "archive_controller_spec", to: "archive_controller", label: "tests",
                                    type: "test" }
                                ])
    end
  end

  context "with spec in a subdirectory matching the class name" do
    let(:files) do
      [
        { id: "archiver", path: "app/services/tasks/archiver.rb", type: "service" },
        { id: "archiver_spec", path: "spec/services/tasks/archiver/archiver_spec.rb", type: "spec" }
      ]
    end

    it "collapses the nested spec path" do
      expect(connections).to eq([
                                  { from: "archiver_spec", to: "archiver", label: "tests", type: "test" }
                                ])
    end
  end

  context "with a JS test file" do
    let(:files) do
      [
        { id: "archive_options", path: "frontend/js/ProjectArchive/ArchiveOptions.js", type: "component" },
        { id: "archive_options_test", path: "frontend/js/ProjectArchive/ArchiveOptions.test.js", type: "spec" }
      ]
    end

    it "matches .test.js to .js" do
      expect(connections).to eq([
                                  { from: "archive_options_test", to: "archive_options", label: "tests", type: "test" }
                                ])
    end
  end

  context "with no matching source file" do
    let(:files) do
      [
        { id: "user", path: "app/models/user.rb", type: "model" },
        { id: "widget_spec", path: "spec/models/widget_spec.rb", type: "spec" }
      ]
    end

    it "returns empty" do
      expect(connections).to be_empty
    end
  end

  context "with a feature spec (no direct source match)" do
    let(:files) do
      [
        { id: "archiver", path: "app/services/tasks/archiver.rb", type: "service" },
        { id: "archiving_a_team_project_spec",
          path: "spec/features/projects/archiving/archiving_a_team_project_spec.rb", type: "spec" }
      ]
    end

    it "does not match feature specs to unrelated sources" do
      expect(connections).to be_empty
    end
  end
end

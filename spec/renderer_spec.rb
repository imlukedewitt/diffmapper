# frozen_string_literal: true

require "diffmapper"
require "diffmapper/parser"
require "diffmapper/renderer"

RSpec.describe Diffmapper::Renderer do
  subject(:html) { described_class.new(data).call }

  let(:diff_text) { File.read(File.join(__dir__, "fixtures/diffs/real_pr.diff")) }
  let(:data) { Diffmapper::Parser.new(diff_text).call }

  it "produces an HTML document" do
    expect(html).to include("<!DOCTYPE html>")
    expect(html).to include("</html>")
  end

  it "includes a card for each file" do
    data[:files].each do |file|
      expect(html).to include("id=\"card-#{file[:id]}\"")
    end
  end

  it "shows file paths" do
    expect(html).to include("app/controllers/team_projects/archive_controller.rb")
  end

  it "shows line counts" do
    expect(html).to include("+2")
    expect(html).to include("-1")
  end

  it "includes stats in the top bar" do
    expect(html).to include("+149")
    expect(html).to include("-10")
    expect(html).to include("13 files")
  end

  it "embeds connections as JSON" do
    expect(html).to include('"from":"archive_controller_spec"')
  end

  it "renders summaries when present" do
    data[:files].first[:summary] = "Added a new parameter"
    html_with_summary = described_class.new(data).call
    expect(html_with_summary).to include("Added a new parameter")
  end

  it "renders details when present" do
    data[:files].first[:details] = [{ label: "new method", description: "does stuff" }]
    html_with_details = described_class.new(data).call
    expect(html_with_details).to include("new method")
  end
end

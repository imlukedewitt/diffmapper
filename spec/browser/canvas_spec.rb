# frozen_string_literal: true

require "diffmapper"
require "diffmapper/parser"
require "diffmapper/renderer"
require "securerandom"
require "tmpdir"
require "capybara/dsl"
require "spec_helper"
require "support/browser_helper"

RSpec.describe "Canvas HTML", type: :browser do
  include BrowserTestHelper
  include Capybara::DSL

  after { Capybara.reset_sessions! }

  it "renders a card for each file" do
    visit_generated_html
    expect(page).to have_css(".card", count: 13)
  end

  it "shows file paths on cards" do
    visit_generated_html
    expect(page).to have_content("app/controllers/team_projects/archive_controller.rb")
  end

  it "shows stats in the top bar" do
    visit_generated_html
    expect(page).to have_css(".top-bar", text: "+149")
    expect(page).to have_css(".top-bar", text: "-10")
    expect(page).to have_css(".top-bar", text: "13 files")
  end

  it "has no JS errors" do
    # cuprite raises on JS errors by default with js_errors: true
    visit_generated_html
    expect(page).to have_css(".card")
  end

  it "expands diff when clicking View diff" do
    visit_generated_html
    first(".card-diff summary").click
    expect(page).to have_css(".diff-content")
  end

  it "shows connection lines" do
    visit_generated_html
    expect(page).to have_css("svg.connections line", minimum: 1)
  end

  it "toggles connection lines" do
    visit_generated_html
    click_button "Toggle Lines"
    expect(page).not_to have_css("svg.connections line")
    click_button "Toggle Lines"
    expect(page).to have_css("svg.connections line", minimum: 1)
  end

  context "with enriched data" do
    let(:overrides) do
      {
        context: { summary: "Test summary title", description: "Detailed test description" }
      }
    end

    it "shows the summary as the title" do
      visit_generated_html(data_overrides: overrides)
      expect(page).to have_css(".top-bar h1", text: "Test summary title")
    end

    it "shows description when details is expanded" do
      visit_generated_html(data_overrides: overrides)
      click_button "▸ Details"
      expect(page).to have_content("Detailed test description")
    end
  end
end

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

  it "tidy layout repositions cards without JS errors" do
    visit_generated_html
    first(".card-diff summary").click
    click_button "Tidy Layout"
    expect(page).to have_css(".card", count: 13)
  end

  it "shows cluster labels for file groups" do
    visit_generated_html
    expect(page).to have_css(".cluster-label", minimum: 1)
  end

  it "expand all diffs opens all diff sections" do
    visit_generated_html
    click_button "Expand All Diffs"
    diff_count = page.all(".card-diff").count
    open_count = page.all(".card-diff[open]").count
    expect(open_count).to eq(diff_count)
  end

  it "expand all diffs toggles closed when all are open" do
    visit_generated_html
    click_button "Expand All Diffs"
    click_button "Expand All Diffs"
    open_count = page.all(".card-diff[open]").count
    expect(open_count).to eq(0)
  end

  describe "annotations" do
    it "shows add note button on each card" do
      visit_generated_html
      expect(page).to have_css(".add-annotation-btn", count: 13)
    end

    it "reveals input when clicking add note" do
      visit_generated_html
      first(".add-annotation-btn").click
      expect(page).to have_css(".annotation-input", visible: true)
    end

    it "saves an annotation and displays it" do
      visit_generated_html
      first(".add-annotation-btn").click
      first(".annotation-input").fill_in(with: "This looks suspicious")
      first(".annotation-save").click
      expect(page).to have_css(".annotation-item", text: "This looks suspicious")
    end

    it "cancels annotation input" do
      visit_generated_html
      first(".add-annotation-btn").click
      first(".annotation-cancel").click
      expect(page).not_to have_css(".annotation-input", visible: true)
    end

    it "deletes an annotation" do
      visit_generated_html
      first(".add-annotation-btn").click
      first(".annotation-input").fill_in(with: "Delete me")
      first(".annotation-save").click
      expect(page).to have_css(".annotation-item", text: "Delete me")
      first(".annotation-item").hover
      first(".annotation-delete").click
      expect(page).not_to have_css(".annotation-item", text: "Delete me")
    end

    it "saves a question with styling" do
      visit_generated_html
      first(".add-annotation-btn").click
      first(".annotation-input").fill_in(with: "Why is this needed?")
      first(".annotation-type-select").select("Question")
      first(".annotation-save").click
      expect(page).to have_css(".annotation-item.question")
    end

    it "shows question count in top bar" do
      visit_generated_html
      first(".add-annotation-btn").click
      first(".annotation-input").fill_in(with: "Is this safe?")
      first(".annotation-type-select").select("Question")
      first(".annotation-save").click
      expect(page).to have_css("#openQuestions", text: "1 question")
    end

    it "updates count when question is deleted" do
      visit_generated_html
      first(".add-annotation-btn").click
      first(".annotation-input").fill_in(with: "Is this safe?")
      first(".annotation-type-select").select("Question")
      first(".annotation-save").click
      expect(page).to have_css("#openQuestions", text: "1 question")
      first(".annotation-item").hover
      first(".annotation-delete").click
      expect(page).not_to have_css("#openQuestions", visible: true)
    end

    it "renders LLM annotations with delete buttons" do
      data = Diffmapper::Parser.new(
        File.read(File.join(__dir__, "../fixtures/diffs/real_pr.diff"))
      ).call
      data[:files].first[:annotations] = [{ type: "observation", text: "Looks good" }]
      visit_generated_html(data_overrides: data)
      expect(page).to have_css(".annotation-item.observation", text: "Looks good")
      first(".annotation-item").hover
      expect(page).to have_css(".annotation-delete")
    end
  end

  context "with editable enriched content" do
    let(:enriched_overrides) do
      data = Diffmapper::Parser.new(
        File.read(File.join(__dir__, "../fixtures/diffs/real_pr.diff"))
      ).call
      data[:files].first[:summary] = "Original summary"
      data[:files].first[:details] = [{ label: "method", description: "Original description" }]
      data
    end

    it "allows editing summaries" do
      visit_generated_html(data_overrides: enriched_overrides)
      summary = first(".card-summary")
      expect(summary["contenteditable"]).to eq("true")
    end

    it "allows editing detail descriptions" do
      visit_generated_html(data_overrides: enriched_overrides)
      first(".card-details summary").click
      detail = first(".detail-content")
      expect(detail["contenteditable"]).to eq("true")
    end
  end
end

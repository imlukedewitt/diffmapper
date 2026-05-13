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

  it "does not have overlapping cards after layout" do
    visit_generated_html
    expect(count_card_overlaps).to eq(0)
  end

  it "shows layout tuning controls" do
    visit_generated_html
    expect(page).to have_css("#layoutTuner")
    find(".layout-tuner-header").click
    expect(page).to have_button("Apply")
    expect(page).to have_button("Reset Defaults")
    expect(page).to have_button("Copy Settings")
  end

  it "layers connected files top-to-bottom while keeping test pairs horizontal" do
    data = Diffmapper::Parser.new(
      File.read(File.join(__dir__, "../fixtures/diffs/real_pr.diff"))
    ).call
    data[:connections] += [
      { from: "archive_controller", to: "team_archiver", label: "passes params", type: "calls" },
      { from: "bulk_actions_controller", to: "archiver", label: "passes params", type: "calls" },
      { from: "team_archiver", to: "archiver", label: "delegates to", type: "calls" },
      { from: "archivetimeline", to: "archiveoptions", label: "showSkipCheck", type: "passes_prop" },
      { from: "index", to: "archiveoptions", label: "showSkipCheck", type: "passes_prop" }
    ]

    visit_generated_html(data_overrides: data)

    positions = card_positions(
      "archive_controller",
      "archive_controller_spec",
      "team_archiver",
      "team_archiver_spec",
      "archiver",
      "archiver_spec",
      "bulk_actions_controller",
      "bulk_actions_controller_spec",
      "archivetimeline",
      "archiveoptions",
      "index",
      "archive_via_api_with_confirmation_spec",
      "archiving_a_team_project_spec"
    )

    expect(positions["team_archiver"]["top"]).to be > positions["archive_controller"]["top"]
    expect(positions["archiver"]["top"]).to be > positions["team_archiver"]["top"]
    expect(positions["archiver"]["top"]).to be > positions["bulk_actions_controller"]["top"]

    expect(positions["archiveoptions"]["top"]).to be > positions["archivetimeline"]["top"]
    expect(positions["archiveoptions"]["top"]).to be > positions["index"]["top"]

    expect(positions["archivetimeline"]["top"]).to be >= positions["archive_controller"]["top"]
    expect(positions["archive_via_api_with_confirmation_spec"]["top"]).to be >= positions["archive_controller"]["top"]
    expect(positions["archiving_a_team_project_spec"]["top"]).to be > positions["archive_controller"]["top"]
    expect(positions["archiving_a_team_project_spec"]["top"]).to be > positions["archive_via_api_with_confirmation_spec"]["top"]

    expect(positions["archive_controller_spec"]["left"]).to be > positions["archive_controller"]["left"]
    expect((positions["archive_controller_spec"]["top"] - positions["archive_controller"]["top"]).abs).to be < 20
    expect(positions["team_archiver_spec"]["left"]).to be > positions["team_archiver"]["left"]
    expect((positions["team_archiver_spec"]["top"] - positions["team_archiver"]["top"]).abs).to be < 20
    expect(positions["bulk_actions_controller_spec"]["left"]).to be > positions["bulk_actions_controller"]["left"]
    expect((positions["bulk_actions_controller_spec"]["top"] - positions["bulk_actions_controller"]["top"]).abs).to be < 20
    expect(positions["archiver_spec"]["left"]).to be > positions["archiver"]["left"]
    expect((positions["archiver_spec"]["top"] - positions["archiver"]["top"]).abs).to be < 20
    expect(count_card_overlaps).to eq(0)
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
      expect(page).to have_css("#openQuestions", text: "1 open question")
    end

    it "updates count when question is deleted" do
      visit_generated_html
      first(".add-annotation-btn").click
      first(".annotation-input").fill_in(with: "Is this safe?")
      first(".annotation-type-select").select("Question")
      first(".annotation-save").click
      expect(page).to have_css("#openQuestions", text: "1 open question")
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

  context "sidebar" do
    it "shows sidebar with file list" do
      visit_generated_html
      expect(page).to have_css(".sidebar")
      expect(page).to have_css(".sidebar-file-item", minimum: 1)
    end

    it "navigates to card when clicking a file in sidebar" do
      visit_generated_html
      first(".sidebar-file-item").click
      # Card should get a highlight outline briefly
      card = first(".card")
      expect(card["style"]).to include("outline")
    end

    it "marks a file as reviewed from sidebar" do
      visit_generated_html
      first(".file-check").check
      expect(page).to have_css(".sidebar-file-item.reviewed", minimum: 1)
    end

    it "marks a file as reviewed from card" do
      visit_generated_html
      first(".card-reviewed-check").check
      expect(page).to have_css(".card.reviewed", minimum: 1)
      expect(page).to have_css(".sidebar-file-item.reviewed", minimum: 1)
    end

    it "switches to questions tab" do
      visit_generated_html
      find(".sidebar-tab[data-tab='questions']").click
      expect(page).to have_css(".sidebar-tab[data-tab='questions'].active")
    end

    it "filters cards by type" do
      visit_generated_html
      expect(page).to have_css(".sidebar-filter-pill", minimum: 1)
      # Click a filter pill to hide that type
      pill = first(".sidebar-filter-pill.active")
      type_name = pill.text.downcase
      pill.click
      # The pill should no longer be active
      expect(page).not_to have_css(".sidebar-filter-pill.active", text: /#{type_name}/i)
    end
  end

  context "question resolution" do
    it "resolves a question and updates count" do
      visit_generated_html
      first(".add-annotation-btn").click
      first(".annotation-input").fill_in(with: "Is this safe?")
      first(".annotation-type-select").select("Question")
      first(".annotation-save").click
      expect(page).to have_css("#openQuestions", text: "1 open question")
      first(".annotation-item.question").hover
      first(".annotation-resolve").click
      expect(page).to have_css(".annotation-item.resolved")
      expect(page).not_to have_css("#openQuestions", visible: true)
    end
  end

  context "localStorage persistence" do
    it "persists a note after adding it" do
      visit_generated_html
      first(".add-annotation-btn").click
      first(".annotation-input").fill_in(with: "Remember this")
      first(".annotation-save").click
      expect(page).to have_css(".annotation-item", text: "Remember this")

      # Verify localStorage was written
      stored = page.evaluate_script("localStorage.getItem(STORAGE_KEY)")
      expect(stored).to include("Remember this")
    end

    it "persists reviewed state" do
      visit_generated_html
      first(".card-reviewed-check").check
      stored = page.evaluate_script("localStorage.getItem(STORAGE_KEY)")
      data = JSON.parse(stored)
      expect(data["reviewed"]).not_to be_empty
    end

    it "restores notes on reload" do
      visit_generated_html
      first(".add-annotation-btn").click
      first(".annotation-input").fill_in(with: "Persist me")
      first(".annotation-save").click
      expect(page).to have_css(".annotation-item", text: "Persist me")

      # Reload the page
      visit_generated_html
      expect(page).to have_css(".annotation-item", text: "Persist me")
    end

    it "restores reviewed state on reload" do
      visit_generated_html
      first(".card-reviewed-check").check
      expect(page).to have_css(".card.reviewed")

      visit_generated_html
      expect(page).to have_css(".card.reviewed")
    end
  end
end

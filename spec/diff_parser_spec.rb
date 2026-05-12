# frozen_string_literal: true

require "diffmapper"
require "diffmapper/diff_parser"

RSpec.describe Diffmapper::DiffParser do
  subject(:result) { described_class.new(diff_text).parse }

  let(:diff_text) { File.read(File.join(__dir__, "fixtures/diffs/three_files.diff")) }

  it "parses all three files" do
    expect(result[:files].length).to eq(3)
  end

  it "extracts file paths" do
    paths = result[:files].map { |f| f[:path] }
    expect(paths).to eq([
                          "app/models/user.rb",
                          "app/services/notifier.rb",
                          "app/models/legacy.rb"
                        ])
  end

  it "detects statuses" do
    statuses = result[:files].map { |f| f[:status] }
    expect(statuses).to eq(%w[modified new deleted])
  end

  it "counts additions and deletions" do
    user = result[:files].first
    expect(user[:additions]).to eq(3)
    expect(user[:deletions]).to eq(1)
  end

  it "computes meta stats" do
    stats = result[:meta][:stats]
    expect(stats[:files]).to eq(3)
    expect(stats[:additions]).to eq(8)
    expect(stats[:deletions]).to eq(4)
  end

  it "generates ids from filenames" do
    ids = result[:files].map { |f| f[:id] }
    expect(ids).to eq(%w[user notifier legacy])
  end

  it "includes hunks starting with @@" do
    expect(result[:files].first[:hunks]).to start_with("@@")
  end

  context "with duplicate filenames in different directories" do
    let(:diff_text) do
      <<~DIFF
        diff --git a/app/models/user.rb b/app/models/user.rb
        index abc..def 100644
        --- a/app/models/user.rb
        +++ b/app/models/user.rb
        @@ -1,3 +1,4 @@
         class User
        +  # change
         end
        diff --git a/app/models/admin/user.rb b/app/models/admin/user.rb
        index abc..def 100644
        --- a/app/models/admin/user.rb
        +++ b/app/models/admin/user.rb
        @@ -1,3 +1,4 @@
         class Admin::User
        +  # change
         end
      DIFF
    end

    it "deduplicates ids" do
      ids = result[:files].map { |f| f[:id] }
      expect(ids).to eq(%w[user user_2])
    end
  end
end

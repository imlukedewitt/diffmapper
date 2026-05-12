# frozen_string_literal: true

require "diffmapper"
require "diffmapper/file_classifier"

RSpec.describe Diffmapper::FileClassifier do
  describe ".classify" do
    {
      "app/models/user.rb" => "model",
      "app/models/metering/meter.rb" => "model",
      "app/controllers/users_controller.rb" => "controller",
      "app/controllers/metering/meters_controller.rb" => "controller",
      "app/serializers/api/v1/user_serializer.rb" => "serializer",
      "app/services/meter_destroyer.rb" => "service",
      "app/jobs/cleanup_job.rb" => "job",
      "app/workers/sync_worker.rb" => "job",
      "spec/models/user_spec.rb" => "spec",
      "spec/controllers/users_controller_spec.rb" => "spec",
      "test/models/user_test.rb" => "spec",
      "src/components/MeterChart/MeterChart.test.js" => "spec",
      "app/views/users/index.html.erb" => "component",
      "src/components/MeterChart.jsx" => "component",
      "src/components/MeterChart.tsx" => "component",
      "config/routes.rb" => "config",
      "config/initializers/foo.rb" => "config",
      "app/assets/stylesheets/main.css" => "styles",
      "src/components/MeterChart.styles.js" => "styles",
      "db/migrate/20230101_add_column.rb" => "migration",
      "lib/some_utility.rb" => "other",
      "README.md" => "other"
    }.each do |path, expected_type|
      it "classifies #{path} as #{expected_type}" do
        expect(described_class.classify(path)).to eq(expected_type)
      end
    end
  end
end

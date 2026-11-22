import config from '../../jest.config';

const INTEGRATION_TIMEOUT_MS = 20000;

describe('jest config timeout contract', () => {
  it('applies the integration timeout through the global testTimeout the runner reads', () => {
    // Arrange / Act
    const effective = config.testTimeout;

    // Assert
    expect(effective).toBe(INTEGRATION_TIMEOUT_MS);
  });
});

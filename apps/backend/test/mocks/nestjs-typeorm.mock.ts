export const InjectRepository = (entity: any) => () => {};
export const getRepositoryToken = (entity: any) => `MockToken_${entity?.name || entity}`;
export const TypeOrmModule = {
  forRoot: jest.fn(),
  forFeature: jest.fn(),
};

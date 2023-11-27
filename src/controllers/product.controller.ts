import * as fs from 'fs';
import {inject} from '@loopback/core';
import {
  Count,
  CountSchema,
  Filter,
  FilterExcludingWhere,
  repository,
  Where,
} from '@loopback/repository';
import {
  post,
  param,
  get,
  getModelSchemaRef,
  oas,
  patch,
  put,
  del,
  requestBody,
  response,
  RestBindings,
  Request,
  Response,
} from '@loopback/rest';
import path from 'path';
import {Product} from '../models';
import {ProductRepository} from '../repositories';

const IMAGE_FOLDER = 'images';
const PRODUCT_IMAGE_FOLDER = 'product';
const PRODUCT_IMAGE_PREVIEW_PREFIX = 'preview_';

export class ProductController {
  private readonly imageStorageDirectory: string;
  constructor(
    @repository(ProductRepository)
    public productRepository : ProductRepository,
    @inject(RestBindings.Http.REQUEST) private req: Request
  ) {
    this.imageStorageDirectory = path.join(IMAGE_FOLDER, PRODUCT_IMAGE_FOLDER);
  }

  @post('/products')
  @response(200, {
    description: 'Product model instance',
    content: {'application/json': {schema: getModelSchemaRef(Product)}},
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Product, {
            title: 'NewProduct',
            exclude: ['id'],
          }),
        },
      },
    })
    product: Omit<Product, 'id'>,
  ): Promise<Product> {
    return this.productRepository.create(product);
  }

  @get('/products/count')
  @response(200, {
    description: 'Product model count',
    content: {'application/json': {schema: CountSchema}},
  })
  async count(
    @param.where(Product) where?: Where<Product>,
  ): Promise<Count> {
    return this.productRepository.count(where);
  }

  @get('/products')
  @response(200, {
    description: 'Array of Product model instances',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(Product, {includeRelations: true}),
        },
      },
    },
  })
  async find(
    @param.filter(Product) filter?: Filter<Product>,
  ): Promise<Product[]> {
    return this.productRepository.find(filter);
  }

  @patch('/products')
  @response(200, {
    description: 'Product PATCH success count',
    content: {'application/json': {schema: CountSchema}},
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Product, {partial: true}),
        },
      },
    })
    product: Product,
    @param.where(Product) where?: Where<Product>,
  ): Promise<Count> {
    return this.productRepository.updateAll(product, where);
  }

  @get('/products/{id}')
  @response(200, {
    description: 'Product model instance',
    content: {
      'application/json': {
        schema: getModelSchemaRef(Product, {includeRelations: true}),
      },
    },
  })
  async findById(
    @param.path.string('id') id: string,
    @param.filter(Product, {exclude: 'where'}) filter?: FilterExcludingWhere<Product>
  ): Promise<Product> {
    return this.productRepository.findById(id, filter);
  }

  @patch('/products/{id}')
  @response(204, {
    description: 'Product PATCH success',
  })
  async updateById(
    @param.path.string('id') id: string,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Product, {partial: true}),
        },
      },
    })
    product: Product,
  ): Promise<void> {
    await this.productRepository.updateById(id, product);
  }

  @put('/products/{id}')
  @response(204, {
    description: 'Product PUT success',
  })
  async replaceById(
    @param.path.string('id') id: string,
    @requestBody() product: Product,
  ): Promise<void> {
    if (product.previewImage?.startsWith('data:image')) {
      await this.handleRawImageProductReplacement(product)
    } else {
      await this.productRepository.replaceById(id, product);
    }
  }

  @del('/products/{id}')
  @response(204, {
    description: 'Product DELETE success',
  })
  async deleteById(@param.path.string('id') id: string): Promise<void> {
    const product = await this.productRepository.findById(id);
    if (product?.previewImage) {
      this.deleteProductPreviewImage(product);
    }
    await this.productRepository.deleteById(id);
  }

  @get('/product-images/{filename}')
  @oas.response.file()
  sendFile(
    @param.path.string('filename') fileName: string,
    @inject(RestBindings.Http.RESPONSE) res: Response,
  ) {
    const filePath = path.resolve(this.imageStorageDirectory, fileName);
    res.sendFile(filePath);
    return res;
  }

  private async handleRawImageProductReplacement(product: Product) {
    if (!product.previewImage) {
      await this.productRepository.replaceById(product.id, product);
      return;
    }
    const ext = product.previewImage.split(';')[0].match(/jpeg|png|jpg/)?.[0] ?? '';
    const data = product.previewImage.replace(/^data:image\/\w+;base64,/, '');
    const buf = Buffer.from(data, 'base64');
    const storageFileName = `${PRODUCT_IMAGE_PREVIEW_PREFIX}${product.id}.${ext}`
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    fs.writeFile(`${this.imageStorageDirectory}/${storageFileName}`, buf, async (error) => {
      if (error) {
        // todo it'll be good to have some error logger here
        console.warn(`Error writing preview image for product ${product.id}`, error);
      } else {
        product.previewImage = `${this.req.protocol}://${this.req.headers.host}/product-images/${storageFileName}`;
      }
      await this.productRepository.replaceById(product.id, product);
    });
  }

  private deleteProductPreviewImage(product: Product) {
    const previewFileName = product.previewImage?.split('/').pop();
    if (previewFileName) {
      fs.unlink(`${this.imageStorageDirectory}/${previewFileName}`, (error) => {
        if (error) {
          // todo it'll be good to have some error logger here
          console.warn(`Error deleting preview image for product ${product.id}`, error)
        }
      })
    }
  }
}

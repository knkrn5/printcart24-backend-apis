import { Router } from 'express';
import asyncHandler from '#utils/asyncHandler';
import { verifyUserToken } from '#middlewares/auth';
import {
    saveBatchDocumentDetails,
    getUserDocuments,
    getDocumentById,
    updateDocumentCustomization,
    deleteDocument,
    clearAllDocuments,
    createQuickPrintDocument,
} from '#controllers/printDocument';

const printDocumentRouter = Router();

printDocumentRouter.use(verifyUserToken);

printDocumentRouter.route('/quick-print').post(asyncHandler(createQuickPrintDocument));
printDocumentRouter
    .route('/')
    .get(asyncHandler(getUserDocuments))
    .delete(asyncHandler(clearAllDocuments));
printDocumentRouter.route('/batch').post(asyncHandler(saveBatchDocumentDetails));

printDocumentRouter
    .route('/:documentId')
    .get(asyncHandler(getDocumentById))
    .patch(asyncHandler(updateDocumentCustomization))
    .delete(asyncHandler(deleteDocument));

export default printDocumentRouter;
